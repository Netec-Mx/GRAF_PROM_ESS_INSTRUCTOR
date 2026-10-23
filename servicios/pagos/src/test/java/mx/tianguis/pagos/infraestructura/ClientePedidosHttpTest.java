package mx.tianguis.pagos.infraestructura;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.math.BigDecimal;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Map;
import mx.tianguis.pagos.aplicacion.PedidoConsultado;
import mx.tianguis.pagos.aplicacion.PedidosNoDisponibleException;
import mx.tianguis.pagos.dominio.PedidoNoEncontradoException;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

/** El cliente contra un servidor HTTP de mentira que imita las respuestas de pedidos. */
class ClientePedidosHttpTest {

    private static final Map<String, String> CUERPOS = Map.of(
            "PED-000001",
                    "{\"id\":\"PED-000001\",\"estado\":\"confirmado\",\"lineas\":[],\"total_mxn\":\"275.50\","
                            + "\"creado_en\":\"2026-10-12T00:50:29Z\"}",
            "PED-000002",
                    "{\"id\":\"PED-000002\",\"estado\":\"rechazado_sin_stock\",\"lineas\":[],\"total_mxn\":\"0.00\","
                            + "\"creado_en\":\"2026-10-12T00:50:30Z\"}",
            "PED-000820", "{\"id\":\"PED-000820\",\"estado\":\"confirmado\",\"total_mxn\":\"1.00\"}",
            "PED-000600", "esto no es json",
            "PED-000700", "{\"id\":\"PED-000700\",\"estado\":\"confirmado\",\"total_mxn\":275.5,\"creado_en\":\"x\"}",
            "PED-000800", "{\"id\":\"PED-000001\",\"estado\":\"confirmado\",\"total_mxn\":\"1.00\",\"creado_en\":\"x\"}",
            "PED-000810", "{\"id\":\"PED-000810\",\"total_mxn\":\"1.00\",\"creado_en\":\"x\"}");

    private HttpServer servidor;
    private ClientePedidosHttp cliente;

    @BeforeEach
    void levantarServidor() throws IOException {
        servidor = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        servidor.createContext("/pedidos/", intercambio -> {
            String id = intercambio.getRequestURI().getPath().substring("/pedidos/".length());
            int codigo = 200;
            String cuerpo = CUERPOS.get(id);
            if ("PED-000500".equals(id)) {
                codigo = 500;
                cuerpo = "";
            } else if ("PED-000900".equals(id)) {
                dormir(600);
                cuerpo = CUERPOS.get("PED-000001");
            } else if (cuerpo == null) {
                codigo = 404;
                cuerpo = "{\"error\":\"pedido_no_encontrado\",\"mensaje\":\"No existe\"}";
            }
            byte[] bytes = cuerpo.getBytes(StandardCharsets.UTF_8);
            intercambio.getResponseHeaders().add("Content-Type", "application/json");
            intercambio.sendResponseHeaders(codigo, bytes.length == 0 ? -1 : bytes.length);
            if (bytes.length > 0) {
                intercambio.getResponseBody().write(bytes);
            }
            intercambio.close();
        });
        servidor.start();
        cliente = new ClientePedidosHttp(
                "http://127.0.0.1:" + servidor.getAddress().getPort(), Duration.ofMillis(250));
    }

    @AfterEach
    void detenerServidor() {
        servidor.stop(0);
    }

    private static void dormir(long milisegundos) {
        try {
            Thread.sleep(milisegundos);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    @Test
    void unPedidoConfirmadoTraeSuTotalComoBigDecimal() {
        assertThat(cliente.obtener("PED-000001"))
                .isEqualTo(new PedidoConsultado("PED-000001", true, new BigDecimal("275.50"), "2026-10-12T00:50:29Z"));
    }

    @Test
    void unPedidoRechazadoNoEstaConfirmado() {
        assertThat(cliente.obtener("PED-000002").confirmado()).isFalse();
    }

    @Test
    void un404EsPedidoNoEncontrado() {
        assertThatThrownBy(() -> cliente.obtener("PED-000404")).isInstanceOf(PedidoNoEncontradoException.class);
    }

    @ParameterizedTest
    @ValueSource(strings = {"PED-000500", "PED-000600", "PED-000700", "PED-000800", "PED-000810", "PED-000820", "PED-000900"})
    void cualquierOtraRespuestaEsPedidosNoDisponible(String id) {
        // 500, cuerpo que no es JSON, total como número, id distinto, sin estado, sin fecha y timeout.
        assertThatThrownBy(() -> cliente.obtener(id)).isInstanceOf(PedidosNoDisponibleException.class);
    }

    @Test
    void sinNadieEscuchandoEsPedidosNoDisponible() {
        servidor.stop(0);

        assertThatThrownBy(() -> cliente.obtener("PED-000001")).isInstanceOf(PedidosNoDisponibleException.class);
    }
}
