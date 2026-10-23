package mx.tianguis.pagos.api;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.event.Level;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.web.servlet.HandlerMapping;

/**
 * Escribe una línea de log por petición, con la plantilla de la ruta y no la ruta real.
 *
 * <p>/salud queda fuera, para que el healthcheck no tape el tráfico real. /caos también: cada
 * cambio de caos deja su propia línea.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class RegistroDePeticiones extends OncePerRequestFilter {

    /** Valor de route cuando la petición no coincide con ninguna ruta. */
    public static final String RUTA_DESCONOCIDA = "unmatched";

    /** Valor de method para cualquier método HTTP que no sea estándar. */
    public static final String METODO_OTRO = "OTHER";

    private static final Logger LOG = LoggerFactory.getLogger(RegistroDePeticiones.class);

    private static final Set<String> METODOS_CONOCIDOS =
            Set.of("GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "CONNECT", "TRACE");

    private static final double NANOS_POR_MILISEGUNDO = 1_000_000.0;

    @Override
    protected boolean shouldNotFilter(HttpServletRequest peticion) {
        String ruta = peticion.getRequestURI();
        return SaludControlador.RUTA.equals(ruta) || FiltroDeCaos.esDeCaos(ruta);
    }

    @Override
    protected void doFilterInternal(HttpServletRequest peticion, HttpServletResponse respuesta, FilterChain cadena)
            throws ServletException, IOException {
        long inicio = System.nanoTime();
        try {
            cadena.doFilter(peticion, respuesta);
        } finally {
            double milisegundos = Math.round((System.nanoTime() - inicio) / NANOS_POR_MILISEGUNDO * 1000.0) / 1000.0;
            int estado = respuesta.getStatus();
            LOG.atLevel(nivelDe(estado))
                    .addKeyValue("method", metodoAcotado(peticion.getMethod()))
                    .addKeyValue("route", plantillaDeRuta(peticion))
                    .addKeyValue("status", estado)
                    .addKeyValue("duration_ms", milisegundos)
                    .log("peticion atendida");
        }
    }

    static String metodoAcotado(String metodo) {
        return METODOS_CONOCIDOS.contains(metodo) ? metodo : METODO_OTRO;
    }

    private static String plantillaDeRuta(HttpServletRequest peticion) {
        // Spring MVC deja aquí la plantilla, por ejemplo /pagos/{id}, después de resolver la ruta.
        Object plantilla = peticion.getAttribute(HandlerMapping.BEST_MATCHING_PATTERN_ATTRIBUTE);
        return plantilla instanceof String texto ? texto : RUTA_DESCONOCIDA;
    }

    private static Level nivelDe(int estado) {
        if (estado >= 500) {
            return Level.ERROR;
        }
        return estado >= 400 ? Level.WARN : Level.INFO;
    }
}
