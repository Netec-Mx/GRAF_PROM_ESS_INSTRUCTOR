package mx.tianguis.pagos.dominio;

import java.math.BigDecimal;
import java.util.regex.Pattern;

/** Conversión de montos en pesos entre texto y {@link BigDecimal}. Nunca pasa por double. */
public final class Montos {

    /** Decimales de un monto en pesos. */
    public static final int DECIMALES = 2;

    private static final Pattern FORMATO = Pattern.compile("\\d{1,12}\\.\\d{2}");

    private Montos() {}

    /**
     * Convierte un texto con dos decimales exactos, como "275.50".
     *
     * @param texto el monto como texto
     * @return el monto con escala 2
     * @throws MontoInvalidoException si el texto no tiene ese formato
     */
    public static BigDecimal desdeTexto(String texto) {
        if (texto == null || !FORMATO.matcher(texto).matches()) {
            throw new MontoInvalidoException(texto);
        }
        return new BigDecimal(texto);
    }

    /**
     * Devuelve el monto como texto con dos decimales exactos.
     *
     * @param monto un monto con escala 2
     * @return por ejemplo "275.50"
     */
    public static String aTexto(BigDecimal monto) {
        return monto.toPlainString();
    }
}
