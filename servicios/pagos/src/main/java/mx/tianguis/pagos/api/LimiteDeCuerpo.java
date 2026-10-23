package mx.tianguis.pagos.api;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ReadListener;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletInputStream;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Rechaza los cuerpos de petición de más de 16 KB, o de más de 4 KB en /caos.
 *
 * <p>Una solicitud de pago ocupa menos de 100 bytes. Sin este tope, cualquiera podría mandar
 * cuerpos de varios megabytes en paralelo y agotar la memoria del servicio.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 2)
public class LimiteDeCuerpo extends OncePerRequestFilter {

    /** Tamaño máximo del cuerpo de una petición, en bytes. */
    public static final int MAXIMO_BYTES = 16 * 1024;

    /** Tamaño máximo del cuerpo de una petición a /caos, en bytes. */
    public static final int MAXIMO_BYTES_DE_CAOS = 4 * 1024;

    private static int maximoPara(HttpServletRequest peticion) {
        return FiltroDeCaos.esDeCaos(peticion.getRequestURI()) ? MAXIMO_BYTES_DE_CAOS : MAXIMO_BYTES;
    }

    private static String mensaje(int maximo) {
        return "El cuerpo no puede pasar de " + maximo / 1024 + " KB";
    }

    @Override
    protected void doFilterInternal(HttpServletRequest peticion, HttpServletResponse respuesta, FilterChain cadena)
            throws ServletException, IOException {
        int maximo = maximoPara(peticion);
        if (peticion.getContentLengthLong() > maximo) {
            rechazar(respuesta, maximo);
            return;
        }
        // Sin Content-Length (cuerpo por trozos) el tamaño se controla al leer.
        try {
            cadena.doFilter(new PeticionAcotada(peticion, maximo), respuesta);
        } catch (CuerpoDemasiadoGrandeException e) {
            if (!respuesta.isCommitted()) {
                rechazar(respuesta, maximo);
            }
        }
    }

    private static void rechazar(HttpServletResponse respuesta, int maximo) throws IOException {
        respuesta.resetBuffer();
        respuesta.setStatus(HttpStatus.CONTENT_TOO_LARGE.value());
        respuesta.setContentType(MediaType.APPLICATION_JSON_VALUE);
        respuesta.setHeader("Connection", "close");
        String cuerpo = "{\"error\":\"cuerpo_demasiado_grande\",\"mensaje\":\"" + mensaje(maximo) + "\"}";
        respuesta.getOutputStream().write(cuerpo.getBytes(StandardCharsets.UTF_8));
    }

    /** El cuerpo leído superó el máximo. */
    static final class CuerpoDemasiadoGrandeException extends IOException {

        private static final long serialVersionUID = 1L;

        CuerpoDemasiadoGrandeException(int maximo) {
            super(mensaje(maximo));
        }
    }

    /** Petición cuyo cuerpo deja de leerse al pasar del máximo. */
    private static final class PeticionAcotada extends HttpServletRequestWrapper {

        private final int maximo;
        private ServletInputStream flujo;

        PeticionAcotada(HttpServletRequest peticion, int maximo) {
            super(peticion);
            this.maximo = maximo;
        }

        @Override
        public ServletInputStream getInputStream() throws IOException {
            if (flujo == null) {
                flujo = new FlujoAcotado(super.getInputStream(), maximo);
            }
            return flujo;
        }
    }

    /** Cuenta los bytes leídos y falla al pasar del máximo. */
    private static final class FlujoAcotado extends ServletInputStream {

        private final ServletInputStream origen;
        private final int maximo;
        private long leidos;

        FlujoAcotado(ServletInputStream origen, int maximo) {
            this.origen = origen;
            this.maximo = maximo;
        }

        private void contar(long cantidad) throws CuerpoDemasiadoGrandeException {
            if (cantidad > 0) {
                leidos += cantidad;
                if (leidos > maximo) {
                    throw new CuerpoDemasiadoGrandeException(maximo);
                }
            }
        }

        @Override
        public int read() throws IOException {
            int dato = origen.read();
            contar(dato >= 0 ? 1 : 0);
            return dato;
        }

        @Override
        public int read(byte[] destino, int desde, int largo) throws IOException {
            int cantidad = origen.read(destino, desde, largo);
            contar(cantidad);
            return cantidad;
        }

        @Override
        public boolean isFinished() {
            return origen.isFinished();
        }

        @Override
        public boolean isReady() {
            return origen.isReady();
        }

        @Override
        public void setReadListener(ReadListener oyente) {
            origen.setReadListener(oyente);
        }

        @Override
        public void close() throws IOException {
            origen.close();
        }
    }
}
