package mx.tianguis.pagos.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.io.IOException;
import java.math.BigDecimal;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.List;
import mx.tianguis.pagos.aplicacion.PasarelaPort;
import mx.tianguis.pagos.aplicacion.PedidoConsultado;
import mx.tianguis.pagos.aplicacion.PedidosNoDisponibleException;
import mx.tianguis.pagos.aplicacion.PedidosPort;
import mx.tianguis.pagos.aplicacion.ResultadoCobro;
import mx.tianguis.pagos.dominio.MetodoPago;
import mx.tianguis.pagos.dominio.PedidoNoEncontradoException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/** La API completa por HTTP real, con pedidos y la pasarela reemplazados por dobles de Mockito. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@DirtiesContext(classMode = DirtiesContext.ClassMode.BEFORE_EACH_TEST_METHOD)
@ExtendWith(OutputCaptureExtension.class)
class ApiTest {

    private static final String PEDIDO = "PED-000001";
    private static final BigDecimal TOTAL = new BigDecimal("275.50");
    private static final String CREADO = "2026-10-12T00:50:29Z";

    private final HttpClient http = HttpClient.newHttpClient();

    @Value("${local.server.port}")
    private int puerto;

    @MockitoBean
    private PedidosPort pedidos;

    @MockitoBean
    private PasarelaPort pasarela;

    @BeforeEach
    void preparar() {
        when(pedidos.obtener(PEDIDO)).thenReturn(new PedidoConsultado(PEDIDO, true, TOTAL, CREADO));
        when(pasarela.cobrar(any(), any())).thenReturn(ResultadoCobro.APROBADO);
    }

    private HttpResponse<String> pedir(String metodo, String ruta, String cuerpo) throws IOException, InterruptedException {
        HttpRequest.BodyPublisher publicador =
                cuerpo == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(cuerpo);
        HttpRequest peticion = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + puerto + ruta))
                .method(metodo, publicador)
                .header("Content-Type", "application/json")
                .build();
        return http.send(peticion, HttpResponse.BodyHandlers.ofString());
    }

    private HttpResponse<String> pagar(String pedidoId, String metodo) throws IOException, InterruptedException {
        return pedir("POST", "/pagos", "{\"pedido_id\":\"" + pedidoId + "\",\"metodo\":\"" + metodo + "\"}");
    }

    @Test
    void pagoAprobadoResponde201ConElContratoDelSpec() throws Exception {
        HttpResponse<String> respuesta = pagar(PEDIDO, "tarjeta");

        assertThat(respuesta.statusCode()).isEqualTo(201);
        assertThat(respuesta.body())
                .isEqualTo("{\"id\":\"PAG-000001\",\"pedido_id\":\"PED-000001\",\"pedido_creado_en\":\"2026-10-12T00:50:29Z\",\"monto_mxn\":\"275.50\","
                        + "\"metodo\":\"tarjeta\",\"estado\":\"aprobado\"}");
        assertThat(respuesta.headers().firstValue("Location")).contains("/pagos/PAG-000001");
    }

    @ParameterizedTest
    @CsvSource({"RECHAZADO_POR_FONDOS, 402, rechazado", "ERROR, 502, error_pasarela"})
    void pasarelaQueNoApruebaResponde402o502YGuardaElPago(ResultadoCobro cobro, int codigo, String estado) throws Exception {
        when(pasarela.cobrar(any(), any())).thenReturn(cobro);

        HttpResponse<String> respuesta = pagar(PEDIDO, "spei");

        assertThat(respuesta.statusCode()).isEqualTo(codigo);
        assertThat(respuesta.body()).contains("\"estado\":\"" + estado + "\"", "\"id\":\"PAG-000001\"");
        assertThat(pedir("GET", "/pagos/PAG-000001", null).body()).isEqualTo(respuesta.body());
    }

    @Test
    void pedidoInexistenteResponde404() throws Exception {
        when(pedidos.obtener("PED-000404")).thenThrow(new PedidoNoEncontradoException("PED-000404"));

        HttpResponse<String> respuesta = pagar("PED-000404", "tarjeta");

        assertThat(respuesta.statusCode()).isEqualTo(404);
        assertThat(respuesta.body()).contains("\"error\":\"pedido_no_encontrado\"");
    }

    @Test
    void pedidoNoConfirmadoResponde409() throws Exception {
        when(pedidos.obtener(PEDIDO)).thenReturn(new PedidoConsultado(PEDIDO, false, new BigDecimal("0.00"), CREADO));

        HttpResponse<String> respuesta = pagar(PEDIDO, "tarjeta");

        assertThat(respuesta.statusCode()).isEqualTo(409);
        assertThat(respuesta.body()).contains("\"error\":\"pedido_no_confirmado\"");
    }

    @Test
    void pedidoYaPagadoResponde409() throws Exception {
        pagar(PEDIDO, "tarjeta");

        HttpResponse<String> respuesta = pagar(PEDIDO, "oxxo");

        assertThat(respuesta.statusCode()).isEqualTo(409);
        assertThat(respuesta.body()).contains("\"error\":\"pedido_ya_pagado\"");
    }

    @Test
    void pedidosCaidoResponde503() throws Exception {
        when(pedidos.obtener(PEDIDO)).thenThrow(new PedidosNoDisponibleException("sin conexión", null));

        HttpResponse<String> respuesta = pagar(PEDIDO, "tarjeta");

        assertThat(respuesta.statusCode()).isEqualTo(503);
        assertThat(respuesta.body()).contains("\"error\":\"pedidos_no_disponible\"");
    }

    @Test
    void elMontoQueMandaElClienteSeIgnora() throws Exception {
        HttpResponse<String> respuesta = pedir(
                "POST",
                "/pagos",
                "{\"pedido_id\":\"PED-000001\",\"metodo\":\"tarjeta\",\"monto_mxn\":\"1.00\",\"monto\":1}");

        assertThat(respuesta.statusCode()).isEqualTo(201);
        assertThat(respuesta.body()).contains("\"monto_mxn\":\"275.50\"");
        verify(pasarela).cobrar(MetodoPago.TARJETA, TOTAL);
    }

    @ParameterizedTest
    @ValueSource(
            strings = {
                "esto no es json",
                "{}",
                "{\"pedido_id\":\"PED-000001\"}",
                "{\"pedido_id\":\"PED-000001\",\"metodo\":\"efectivo\"}",
                "{\"pedido_id\":\"../salud\",\"metodo\":\"tarjeta\"}",
                "{\"pedido_id\":123,\"metodo\":[]}"
            })
    void unaSolicitudMalFormadaResponde400(String cuerpo) throws Exception {
        HttpResponse<String> respuesta = pedir("POST", "/pagos", cuerpo);

        assertThat(respuesta.statusCode()).isEqualTo(400);
        assertThat(respuesta.body()).contains("\"error\":\"solicitud_invalida\"");
    }

    @Test
    void unCuerpoDeMasDe16KbResponde413SinLlegarAlCasoDeUso() throws Exception {
        String relleno = "x".repeat(LimiteDeCuerpo.MAXIMO_BYTES);
        String cuerpo = "{\"pedido_id\":\"PED-000001\",\"metodo\":\"tarjeta\",\"relleno\":\"" + relleno + "\"}";

        HttpResponse<String> conLargo = pedir("POST", "/pagos", cuerpo);
        HttpRequest porTrozos = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + puerto + "/pagos"))
                .POST(HttpRequest.BodyPublishers.ofInputStream(
                        () -> new java.io.ByteArrayInputStream(cuerpo.getBytes(java.nio.charset.StandardCharsets.UTF_8))))
                .header("Content-Type", "application/json")
                .build();
        HttpResponse<String> sinLargo = http.send(porTrozos, HttpResponse.BodyHandlers.ofString());

        assertThat(conLargo.statusCode()).isEqualTo(413);
        assertThat(conLargo.body()).contains("\"error\":\"cuerpo_demasiado_grande\"");
        assertThat(sinLargo.statusCode()).isEqualTo(413);
        assertThat(sinLargo.body()).contains("\"error\":\"cuerpo_demasiado_grande\"");
        org.mockito.Mockito.verifyNoInteractions(pedidos, pasarela);
    }

    @Test
    void rutasYPagosQueNoExistenResponden404EnJson() throws Exception {
        assertThat(pedir("GET", "/pagos/PAG-000099", null).body()).contains("\"error\":\"pago_no_encontrado\"");

        HttpResponse<String> sinRuta = pedir("GET", "/no-existe", null);
        assertThat(sinRuta.statusCode()).isEqualTo(404);
        assertThat(sinRuta.body()).contains("\"error\":\"error_http\"");
        assertThat(pedir("DELETE", "/pagos", null).statusCode()).isEqualTo(405);
        assertThat(pedir("GET", "/metrics", null).statusCode()).isEqualTo(404);
        assertThat(pedir("GET", "/actuator/prometheus", null).statusCode()).isEqualTo(404);
    }

    @Test
    void listaDePagosVaEnvueltaYSeFiltraPorEstado() throws Exception {
        when(pedidos.obtener("PED-000002")).thenReturn(new PedidoConsultado("PED-000002", true, new BigDecimal("89.00"), CREADO));
        assertThat(pedir("GET", "/pagos", null).body()).isEqualTo("{\"total\":0,\"pagos\":[]}");

        pagar(PEDIDO, "tarjeta");
        when(pasarela.cobrar(any(), any())).thenReturn(ResultadoCobro.RECHAZADO_POR_FONDOS);
        pagar("PED-000002", "spei");

        HttpResponse<String> todos = pedir("GET", "/pagos", null);
        assertThat(todos.statusCode()).isEqualTo(200);
        assertThat(todos.body())
                .isEqualTo("{\"total\":2,\"pagos\":["
                        + "{\"id\":\"PAG-000001\",\"pedido_id\":\"PED-000001\",\"pedido_creado_en\":\"2026-10-12T00:50:29Z\",\"monto_mxn\":\"275.50\","
                        + "\"metodo\":\"tarjeta\",\"estado\":\"aprobado\"},"
                        + "{\"id\":\"PAG-000002\",\"pedido_id\":\"PED-000002\",\"pedido_creado_en\":\"2026-10-12T00:50:29Z\",\"monto_mxn\":\"89.00\","
                        + "\"metodo\":\"spei\",\"estado\":\"rechazado\"}]}");
        assertThat(pedir("GET", "/pagos?estado=aprobado", null).body())
                .startsWith("{\"total\":1,\"pagos\":[{\"id\":\"PAG-000001\"");
        assertThat(pedir("GET", "/pagos?estado=rechazado", null).body())
                .startsWith("{\"total\":1,\"pagos\":[{\"id\":\"PAG-000002\"");
        assertThat(pedir("GET", "/pagos?estado=inventado", null).body()).isEqualTo("{\"total\":0,\"pagos\":[]}");
    }

    @Test
    void saludResponde200() throws Exception {
        HttpResponse<String> respuesta = pedir("GET", "/salud", null);

        assertThat(respuesta.statusCode()).isEqualTo(200);
        assertThat(respuesta.body()).isEqualTo("{\"estado\":\"ok\"}");
    }

    @Test
    void losLogsSonJsonConLaPlantillaDeLaRutaYSinSalud(CapturedOutput salida) throws Exception {
        pagar(PEDIDO, "oxxo");
        pedir("GET", "/pagos/PAG-000001", null);
        pedir("GET", "/pagos/PAG-000777", null);
        pedir("GET", "/no-existe/abc", null);
        pedir("FOO", "/pagos", null);
        pedir("GET", "/salud", null);

        List<String> lineas = salida.getOut().lines()
                .filter(linea -> linea.contains("\"msg\":\"peticion atendida\"") || linea.contains("\"msg\":\"pago procesado\""))
                .toList();

        assertThat(lineas).hasSize(6);
        assertThat(lineas.get(0))
                .startsWith("{\"timestamp\":\"")
                .contains(
                        "\"level\":\"info\"",
                        "\"service\":\"pagos\"",
                        "\"payment_id\":\"PAG-000001\"",
                        "\"order_id\":\"PED-000001\"",
                        "\"method\":\"oxxo\"",
                        "\"result\":\"approved\"",
                        "\"amount_mxn\":\"275.50\"");
        assertThat(lineas.get(1))
                .contains("\"method\":\"POST\"", "\"route\":\"/pagos\"", "\"status\":201", "\"duration_ms\":");
        assertThat(lineas.get(2)).contains("\"route\":\"/pagos/{id}\"", "\"status\":200", "\"level\":\"info\"");
        assertThat(lineas.get(3)).contains("\"route\":\"/pagos/{id}\"", "\"status\":404", "\"level\":\"warning\"");
        assertThat(lineas.get(4)).contains("\"route\":\"unmatched\"", "\"status\":404");
        assertThat(lineas.get(5)).contains("\"method\":\"OTHER\"");
        assertThat(lineas).noneMatch(linea -> linea.contains("PAG-000777") || linea.contains("/salud"));
    }
}
