package mx.tianguis.pagos.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.io.IOException;
import java.math.BigDecimal;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import mx.tianguis.pagos.aplicacion.PasarelaPort;
import mx.tianguis.pagos.aplicacion.PedidoConsultado;
import mx.tianguis.pagos.aplicacion.PedidosPort;
import mx.tianguis.pagos.aplicacion.ResultadoCobro;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/**
 * Un pedido pagado no se cobra dos veces aunque su pago ya se haya descartado del repositorio.
 *
 * <p>El repositorio de esta prueba conserva solo 3 pagos, para forzar el descarte.
 */
@SpringBootTest(
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = "pagos.repositorio.capacidad=3")
class DobleCobroApiTest {

    private final HttpClient http = HttpClient.newHttpClient();

    @Value("${local.server.port}")
    private int puerto;

    @MockitoBean
    private PedidosPort pedidos;

    @MockitoBean
    private PasarelaPort pasarela;

    private HttpResponse<String> pedir(String metodo, String ruta, String cuerpo) throws IOException, InterruptedException {
        HttpRequest peticion = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + puerto + ruta))
                .method(metodo, cuerpo == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(cuerpo))
                .header("Content-Type", "application/json")
                .build();
        return http.send(peticion, HttpResponse.BodyHandlers.ofString());
    }

    private HttpResponse<String> pagar(String pedidoId) throws IOException, InterruptedException {
        return pedir("POST", "/pagos", "{\"pedido_id\":\"" + pedidoId + "\",\"metodo\":\"tarjeta\"}");
    }

    @Test
    void unPedidoPagadoYLuegoDescartadoSigueRechazandoElSegundoCobroCon409() throws Exception {
        when(pedidos.obtener(any())).thenAnswer(llamada -> {
            String id = llamada.getArgument(0);
            return new PedidoConsultado(id, true, new BigDecimal("275.50"), "2026-10-12T00:50:29Z");
        });
        when(pasarela.cobrar(any(), any())).thenReturn(ResultadoCobro.APROBADO);

        assertThat(pagar("PED-000001").statusCode()).isEqualTo(201);
        for (int i = 2; i <= 5; i++) {
            assertThat(pagar("PED-00000" + i).statusCode()).isEqualTo(201);
        }

        // El pago PAG-000001 ya se descartó: el repositorio conserva los 3 últimos.
        assertThat(pedir("GET", "/pagos/PAG-000001", null).statusCode()).isEqualTo(404);
        assertThat(pedir("GET", "/pagos/PAG-000003", null).statusCode()).isEqualTo(200);

        HttpResponse<String> segundoCobro = pagar("PED-000001");

        assertThat(segundoCobro.statusCode()).isEqualTo(409);
        assertThat(segundoCobro.body()).contains("\"error\":\"pedido_ya_pagado\"");
        verify(pasarela, times(5)).cobrar(any(), any());
    }
}
