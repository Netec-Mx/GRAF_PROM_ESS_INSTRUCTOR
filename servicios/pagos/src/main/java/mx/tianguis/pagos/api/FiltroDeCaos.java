package mx.tianguis.pagos.api;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.HandlerInterceptor;
import org.springframework.web.servlet.HandlerMapping;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * Cuida la entrada a /caos.
 *
 * <p>Si el servicio arrancó con CAOS_TOKEN vacío, /caos no existe: responde 404 igual que una
 * ruta desconocida. Si hay token, la cabecera X-Caos-Token debe traerlo; si no, 401.
 *
 * <p>La decisión se toma sobre el controlador que Spring eligió para la petición, no sobre el
 * texto de la URL. Así no importa cómo venga escrita la ruta: /caos;x=1 o /%63aos llegan al
 * mismo controlador que /caos y pasan por el mismo control. Además solo se acepta la ruta
 * escrita tal cual; las otras formas responden 404, porque el tope de 4 KB del cuerpo y la
 * exclusión del log sí miran el texto de la URL.
 */
@Component
public class FiltroDeCaos implements HandlerInterceptor, WebMvcConfigurer {

    /** Cabecera obligatoria en todas las rutas de /caos. */
    public static final String CABECERA = "X-Caos-Token";

    private static final Logger LOG = LoggerFactory.getLogger(FiltroDeCaos.class);

    private final byte[] esperado;

    FiltroDeCaos(@Value("${pagos.caos.token}") String esperado) {
        this.esperado = esperado.getBytes(StandardCharsets.UTF_8);
    }

    /**
     * Dice si una ruta, tal como viene escrita, es /caos o cuelga de ella.
     *
     * @param ruta la ruta de la petición
     * @return true si es de caos
     */
    static boolean esDeCaos(String ruta) {
        return CaosControlador.RUTA.equals(ruta) || ruta.startsWith(CaosControlador.RUTA + "/");
    }

    @Override
    public void addInterceptors(InterceptorRegistry registro) {
        registro.addInterceptor(this);
    }

    @Override
    public boolean preHandle(HttpServletRequest peticion, HttpServletResponse respuesta, Object manejador)
            throws IOException {
        boolean vaACaos = manejador instanceof HandlerMethod metodo && metodo.getBeanType() == CaosControlador.class;
        if (!vaACaos) {
            return true;
        }
        if (esperado.length == 0 || !esDeCaos(peticion.getRequestURI())) {
            return responder(respuesta, HttpStatus.NOT_FOUND, "error_http", "La petición no se pudo atender");
        }
        String recibido = peticion.getHeader(CABECERA);
        byte[] bytes = recibido == null ? new byte[0] : recibido.getBytes(StandardCharsets.UTF_8);
        // isEqual tarda lo mismo acierte o no: no deja adivinar el token por tiempos.
        if (!MessageDigest.isEqual(bytes, esperado)) {
            // El intento queda en el log, sin el token que mandaron.
            Object plantilla = peticion.getAttribute(HandlerMapping.BEST_MATCHING_PATTERN_ATTRIBUTE);
            LOG.atWarn()
                    .addKeyValue("method", RegistroDePeticiones.metodoAcotado(peticion.getMethod()))
                    .addKeyValue("route", plantilla instanceof String texto ? texto : RegistroDePeticiones.RUTA_DESCONOCIDA)
                    .addKeyValue("status", HttpStatus.UNAUTHORIZED.value())
                    .log("acceso a caos rechazado");
            return responder(respuesta, HttpStatus.UNAUTHORIZED, "token_invalido", "Falta " + CABECERA + " o no coincide");
        }
        return true;
    }

    private static boolean responder(HttpServletResponse respuesta, HttpStatus estado, String codigo, String mensaje)
            throws IOException {
        respuesta.setStatus(estado.value());
        respuesta.setContentType(MediaType.APPLICATION_JSON_VALUE);
        String cuerpo = "{\"error\":\"" + codigo + "\",\"mensaje\":\"" + mensaje + "\"}";
        respuesta.getOutputStream().write(cuerpo.getBytes(StandardCharsets.UTF_8));
        return false;
    }
}
