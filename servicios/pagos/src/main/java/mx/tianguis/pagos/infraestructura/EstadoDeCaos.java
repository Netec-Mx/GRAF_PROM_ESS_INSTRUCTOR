package mx.tianguis.pagos.infraestructura;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.time.Duration;
import java.time.Instant;
import java.time.InstantSource;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.TreeSet;
import java.util.concurrent.ConcurrentHashMap;
import mx.tianguis.pagos.dominio.MetodoPago;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Qué fallas de caos están encendidas. Se puede usar desde varios hilos.
 *
 * <p>El estado vive solo en memoria: un reinicio del proceso apaga todas las fallas. Dominio y
 * aplicacion no conocen esta clase.
 */
public final class EstadoDeCaos {

    /** Demora extra en la pasarela. */
    public static final String PASARELA_LENTA = "pasarela_lenta";

    /** La pasarela responde con error. */
    public static final String PASARELA_ERRORES = "pasarela_errores";

    /** Todas las fallas del servicio, en el orden en que se muestran. */
    public static final List<String> TIPOS = List.of(PASARELA_LENTA, PASARELA_ERRORES);

    /** Parámetro con la demora en milisegundos. */
    public static final String MS = "ms";

    /** Parámetro con el porcentaje de cobros afectados. */
    public static final String PORCENTAJE = "porcentaje";

    private static final String METODO = "metodo";
    private static final String DURACION = "duracion_s";

    private static final Entero RANGO_MS = new Entero(MS, 100, 10_000, null);
    private static final Entero RANGO_PORCENTAJE = new Entero(PORCENTAJE, 1, 100, 100);
    private static final Entero RANGO_DURACION = new Entero(DURACION, 1, 86_400, null);

    private static final Logger LOG = LoggerFactory.getLogger(EstadoDeCaos.class);

    private final InstantSource reloj;
    private final Map<String, Falla> fallas = new ConcurrentHashMap<>();

    /** El tipo de falla no existe en este servicio. */
    public static final class FallaDesconocidaException extends RuntimeException {

        private static final long serialVersionUID = 1L;

        FallaDesconocidaException(String tipo) {
            super("pagos no tiene una falla llamada " + tipo);
        }
    }

    /** El cuerpo no cumple el contrato del tipo de falla. */
    public static final class ParametrosInvalidosException extends RuntimeException {

        private static final long serialVersionUID = 1L;

        ParametrosInvalidosException(String mensaje) {
            super(mensaje);
        }
    }

    /** Rango de un parámetro entero. Sin valor por defecto, el parámetro es obligatorio u opcional sin valor. */
    private record Entero(String nombre, int minimo, int maximo, Integer porDefecto) {}

    /**
     * Una falla encendida.
     *
     * @param tipo tipo de falla
     * @param enteros parámetros enteros, con sus valores por defecto ya puestos
     * @param metodo método de pago al que se limita, o null si alcanza a todos
     * @param vence cuándo se apaga sola, o null si no vence
     */
    public record Falla(String tipo, Map<String, Integer> enteros, MetodoPago metodo, Instant vence) {

        /**
         * Dice si la falla alcanza a ese método de pago.
         *
         * @param otro el método del cobro
         * @return true si le aplica
         */
        public boolean aplicaA(MetodoPago otro) {
            return metodo == null || metodo == otro;
        }

        /**
         * Devuelve un parámetro entero.
         *
         * @param nombre nombre del parámetro
         * @return su valor
         */
        public int entero(String nombre) {
            return enteros.get(nombre);
        }

        Map<String, Object> parametros() {
            Map<String, Object> parametros = new LinkedHashMap<>(enteros);
            if (metodo != null) {
                parametros.put(METODO, metodo.codigo());
            }
            return parametros;
        }
    }

    /**
     * El estado de una falla tal como sale en GET /caos.
     *
     * @param tipo tipo de falla
     * @param activa si está encendida
     * @param restanteS segundos que le quedan, o null si no vence o está apagada
     * @param parametros parámetros con los que está encendida
     */
    public record Descripcion(
            @JsonProperty("tipo") String tipo,
            @JsonProperty("activa") boolean activa,
            @JsonProperty("restante_s") Long restanteS,
            @JsonProperty("parametros") Map<String, Object> parametros) {}

    /**
     * Crea el estado, con todo apagado.
     *
     * @param reloj de dónde sale la hora; se inyecta para probar duracion_s sin esperar
     */
    public EstadoDeCaos(InstantSource reloj) {
        this.reloj = reloj;
    }

    /**
     * Enciende una falla o reemplaza la que había de ese tipo.
     *
     * @param tipo tipo de falla
     * @param cuerpo el cuerpo JSON ya leído; null vale como vacío
     * @return la falla encendida
     * @throws FallaDesconocidaException si el tipo no existe
     * @throws ParametrosInvalidosException si el cuerpo no cumple el contrato
     */
    public Falla activar(String tipo, Map<String, Object> cuerpo) {
        exigirTipo(tipo);
        Map<String, Object> valores = cuerpo == null ? Map.of() : cuerpo;

        List<Entero> rangos = PASARELA_LENTA.equals(tipo) ? List.of(RANGO_MS, RANGO_PORCENTAJE) : List.of(RANGO_PORCENTAJE);
        TreeSet<String> permitidos = new TreeSet<>(List.of(METODO, DURACION));
        rangos.forEach(rango -> permitidos.add(rango.nombre()));
        for (String nombre : valores.keySet()) {
            if (!permitidos.contains(nombre)) {
                throw new ParametrosInvalidosException(
                        tipo + " no admite " + nombre + ". Admite: " + String.join(", ", permitidos));
            }
        }

        Map<String, Integer> enteros = new LinkedHashMap<>();
        for (Entero rango : rangos) {
            enteros.put(rango.nombre(), leerEntero(valores, rango, true));
        }
        MetodoPago metodo = null;
        if (valores.containsKey(METODO)) {
            metodo = (valores.get(METODO) instanceof String codigo ? MetodoPago.desdeCodigo(codigo) : Optional.<MetodoPago>empty())
                    .orElseThrow(() -> new ParametrosInvalidosException("metodo debe ser tarjeta, oxxo o spei"));
        }
        Integer segundos = leerEntero(valores, RANGO_DURACION, false);
        Instant vence = segundos == null ? null : reloj.instant().plusSeconds(segundos);

        // Sin copiar a un Map.of: así los parámetros salen siempre en el mismo orden.
        Falla falla = new Falla(tipo, Collections.unmodifiableMap(enteros), metodo, vence);
        fallas.put(tipo, falla);
        var linea = LOG.atWarn().addKeyValue("chaos_type", tipo).addKeyValue("params", falla.parametros());
        if (segundos != null) {
            linea = linea.addKeyValue("duration_s", segundos);
        }
        linea.log("caos activado");
        return falla;
    }

    /**
     * Apaga una falla. Si ya estaba apagada no pasa nada.
     *
     * @param tipo tipo de falla
     * @throws FallaDesconocidaException si el tipo no existe
     */
    public void apagar(String tipo) {
        exigirTipo(tipo);
        if (fallas.remove(tipo) != null) {
            LOG.atWarn().addKeyValue("chaos_type", tipo).log("caos apagado");
        }
    }

    /** Apaga todas las fallas. */
    public void apagarTodo() {
        TIPOS.forEach(this::apagar);
    }

    /**
     * Devuelve la falla si está encendida y no venció.
     *
     * @param tipo tipo de falla
     * @return la falla, o vacío
     */
    public Optional<Falla> vigente(String tipo) {
        Falla falla = fallas.get(tipo);
        return falla == null || vencida(falla, reloj.instant()) ? Optional.empty() : Optional.of(falla);
    }

    /**
     * Apaga las fallas vencidas y lo deja en el log.
     *
     * @return los tipos que se apagaron
     */
    public List<String> barrer() {
        Instant ahora = reloj.instant();
        List<String> vencidas = new ArrayList<>();
        for (String tipo : TIPOS) {
            Falla falla = fallas.get(tipo);
            // remove(clave, valor) no borra una falla que alguien acaba de reemplazar.
            if (falla != null && vencida(falla, ahora) && fallas.remove(tipo, falla)) {
                vencidas.add(tipo);
                LOG.atWarn().addKeyValue("chaos_type", tipo).log("caos vencido");
            }
        }
        return vencidas;
    }

    /**
     * Devuelve el estado de todas las fallas.
     *
     * @return una descripción por tipo, en orden
     */
    public List<Descripcion> resumen() {
        return TIPOS.stream().map(this::describir).toList();
    }

    /**
     * Devuelve el estado de una falla.
     *
     * @param tipo tipo de falla
     * @return su descripción
     */
    public Descripcion describir(String tipo) {
        return vigente(tipo)
                .map(falla -> new Descripcion(tipo, true, restante(falla), falla.parametros()))
                .orElseGet(() -> new Descripcion(tipo, false, null, Map.of()));
    }

    /**
     * Dice qué fallas están encendidas, para la métrica chaos.active.
     *
     * @return por cada tipo, si está encendida
     */
    public Map<String, Boolean> activas() {
        Map<String, Boolean> activas = new LinkedHashMap<>();
        TIPOS.forEach(tipo -> activas.put(tipo, vigente(tipo).isPresent()));
        return activas;
    }

    private Long restante(Falla falla) {
        if (falla.vence() == null) {
            return null;
        }
        // Se redondea al segundo más cercano.
        return Math.max(0, Duration.between(reloj.instant(), falla.vence()).plusMillis(500).toSeconds());
    }

    private static boolean vencida(Falla falla, Instant ahora) {
        return falla.vence() != null && !ahora.isBefore(falla.vence());
    }

    private static void exigirTipo(String tipo) {
        if (!TIPOS.contains(tipo)) {
            throw new FallaDesconocidaException(tipo);
        }
    }

    private static Integer leerEntero(Map<String, Object> valores, Entero rango, boolean obligatorio) {
        if (!valores.containsKey(rango.nombre())) {
            if (rango.porDefecto() == null && obligatorio) {
                throw new ParametrosInvalidosException("falta " + rango.nombre());
            }
            return rango.porDefecto();
        }
        // Solo vale un entero JSON: 800.5, "800" o true no pasan.
        if (valores.get(rango.nombre()) instanceof Integer valor && valor >= rango.minimo() && valor <= rango.maximo()) {
            return valor;
        }
        throw new ParametrosInvalidosException(
                rango.nombre() + " debe ser un entero entre " + rango.minimo() + " y " + rango.maximo());
    }
}
