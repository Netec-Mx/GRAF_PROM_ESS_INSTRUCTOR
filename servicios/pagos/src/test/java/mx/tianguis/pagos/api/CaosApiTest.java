package mx.tianguis.pagos.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
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
import mx.tianguis.pagos.infraestructura.EstadoDeCaos;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/** El contrato de /caos por HTTP real, con el token configurado. */
@SpringBootTest(
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = "pagos.caos.token=llave-de-prueba")
@DirtiesContext(classMode = DirtiesContext.ClassMode.BEFORE_EACH_TEST_METHOD)
@ExtendWith(OutputCaptureExtension.class)
class CaosApiTest {

    private static final String LLAVE = "llave-de-prueba";
    private static final String APAGADO = "{\"servicio\":\"pagos\",\"fallas\":["
            + "{\"tipo\":\"pasarela_lenta\",\"activa\":false,\"restante_s\":null,\"parametros\":{}},"
            + "{\"tipo\":\"pasarela_errores\",\"activa\":false,\"restante_s\":null,\"parametros\":{}}]}";

    private final HttpClient http = HttpClient.newHttpClient();

    @Value("${local.server.port}")
    private int puerto;

    @Autowired
    private EstadoDeCaos estado;

    @MockitoBean
    private PedidosPort pedidos;

    @MockitoBean
    private PasarelaPort pasarela;

    private HttpResponse<String> pedir(String metodo, String ruta, String llave, String cuerpo)
            throws IOException, InterruptedException {
        HttpRequest.Builder peticion = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + puerto + ruta))
                .method(
                        metodo,
                        cuerpo == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(cuerpo))
                .header("Content-Type", "application/json");
        if (llave != null) {
            peticion.header(FiltroDeCaos.CABECERA, llave);
        }
        return http.send(peticion.build(), HttpResponse.BodyHandlers.ofString());
    }

    private HttpResponse<String> caos(String metodo, String ruta, String cuerpo) throws IOException, InterruptedException {
        return pedir(metodo, ruta, LLAVE, cuerpo);
    }

    @ParameterizedTest
    @CsvSource({"GET, /caos", "PUT, /caos/pasarela_lenta", "DELETE, /caos/pasarela_lenta", "DELETE, /caos"})
    void sinTokenOConOtroResponde401(String metodo, String ruta) throws Exception {
        String cuerpo = "PUT".equals(metodo) ? "{\"ms\":1500}" : null;

        for (String llave : new String[] {null, "otra", LLAVE + "x", "llave"}) {
            HttpResponse<String> respuesta = pedir(metodo, ruta, llave, cuerpo);

            assertThat(respuesta.statusCode()).isEqualTo(401);
            assertThat(respuesta.body()).contains("\"error\":\"token_invalido\"");
        }
        assertThat(estado.vigente(EstadoDeCaos.PASARELA_LENTA)).isEmpty();
    }

    /** La URL se puede escribir de varias formas que llegan al mismo controlador. */
    @ParameterizedTest
    @ValueSource(strings = {"/caos;x=1", "/%63aos", "/caos;x=1/pasarela_lenta", "/%63aos/pasarela_lenta"})
    void otraFormaDeEscribirLaRutaNoSaltaElToken(String ruta) throws Exception {
        for (String metodo : new String[] {"GET", "PUT", "DELETE"}) {
            for (String llave : new String[] {null, LLAVE}) {
                HttpResponse<String> respuesta = pedir(metodo, ruta, llave, "PUT".equals(metodo) ? "{\"ms\":1500}" : null);

                assertThat(respuesta.statusCode()).isIn(401, 404, 405);
            }
        }
        assertThat(estado.vigente(EstadoDeCaos.PASARELA_LENTA)).isEmpty();
    }

    @Test
    void unIntentoRechazadoDejaSuLineaDeLogSinElToken(CapturedOutput salida) throws Exception {
        pedir("PUT", "/caos/pasarela_lenta", "intento-secreto", "{\"ms\":1500}");
        pedir("GET", "/caos", null, null);
        caos("GET", "/caos", null);

        assertThat(salida.getOut().lines().filter(linea -> linea.contains("\"msg\":\"acceso a caos rechazado\"")))
                .hasSize(2)
                .allSatisfy(linea -> assertThat(linea)
                        .contains("\"level\":\"warning\"", "\"service\":\"pagos\"", "\"status\":401"))
                .anySatisfy(linea -> assertThat(linea).contains("\"method\":\"PUT\"", "\"route\":\"/caos/{tipo}\""))
                .anySatisfy(linea -> assertThat(linea).contains("\"method\":\"GET\"", "\"route\":\"/caos\""));
        assertThat(salida.getOut()).doesNotContain("intento-secreto", LLAVE);
    }

    @Test
    void unTipoEscritoDeOtraFormaTambienPideElToken() throws Exception {
        HttpResponse<String> respuesta = pedir("PUT", "/caos/pasarela%5Flenta;a=b", null, "{\"ms\":1500}");

        assertThat(respuesta.statusCode()).isEqualTo(401);
        assertThat(estado.vigente(EstadoDeCaos.PASARELA_LENTA)).isEmpty();
    }

    @Test
    void getListaTodasLasFallasApagadas() throws Exception {
        HttpResponse<String> respuesta = caos("GET", "/caos", null);

        assertThat(respuesta.statusCode()).isEqualTo(200);
        assertThat(respuesta.body()).isEqualTo(APAGADO);
    }

    @Test
    void putActivaDeleteApagaUnaYDeleteDeTodoApagaTodas() throws Exception {
        HttpResponse<String> lenta = caos("PUT", "/caos/pasarela_lenta", "{\"ms\":1500,\"porcentaje\":30,\"duracion_s\":600}");
        assertThat(lenta.statusCode()).isEqualTo(200);
        assertThat(lenta.body())
                .isEqualTo("{\"tipo\":\"pasarela_lenta\",\"activa\":true,\"restante_s\":600,"
                        + "\"parametros\":{\"ms\":1500,\"porcentaje\":30}}");

        HttpResponse<String> errores = caos("PUT", "/caos/pasarela_errores", null);
        assertThat(errores.statusCode()).isEqualTo(200);
        assertThat(errores.body())
                .isEqualTo("{\"tipo\":\"pasarela_errores\",\"activa\":true,\"restante_s\":null,"
                        + "\"parametros\":{\"porcentaje\":100}}");

        HttpResponse<String> apagada = caos("DELETE", "/caos/pasarela_lenta", null);
        assertThat(apagada.statusCode()).isEqualTo(200);
        assertThat(apagada.body()).contains("\"activa\":false");
        assertThat(estado.vigente(EstadoDeCaos.PASARELA_ERRORES)).isPresent();

        HttpResponse<String> todas = caos("DELETE", "/caos", null);
        assertThat(todas.statusCode()).isEqualTo(200);
        assertThat(todas.body()).isEqualTo(APAGADO);
    }

    @ParameterizedTest
    @ValueSource(
            strings = {
                "{}",
                "{\"ms\":99}",
                "{\"ms\":\"1500\"}",
                "{\"ms\":1500.5}",
                "{\"ms\":1500,\"metodo\":\"efectivo\"}",
                "{\"ms\":1500,\"inventado\":1}",
                "[1500]",
                "ms=1500"
            })
    void parametrosFueraDeContratoResponden400(String cuerpo) throws Exception {
        HttpResponse<String> respuesta = caos("PUT", "/caos/pasarela_lenta", cuerpo);

        assertThat(respuesta.statusCode()).isEqualTo(400);
        assertThat(respuesta.body()).contains("\"error\":\"parametros_invalidos\"");
        assertThat(estado.vigente(EstadoDeCaos.PASARELA_LENTA)).isEmpty();
    }

    @ParameterizedTest
    @ValueSource(strings = {"PUT", "DELETE"})
    void unTipoQueNoExisteResponde404(String metodo) throws Exception {
        HttpResponse<String> respuesta = caos(metodo, "/caos/latencia", "PUT".equals(metodo) ? "{\"ms\":800}" : null);

        assertThat(respuesta.statusCode()).isEqualTo(404);
        assertThat(respuesta.body()).contains("\"error\":\"falla_desconocida\"");
    }

    @Test
    void unCuerpoDeMasDe4KbResponde413() throws Exception {
        String cuerpo = "{\"ms\":1500,\"metodo\":\"" + "x".repeat(4096) + "\"}";

        HttpResponse<String> respuesta = caos("PUT", "/caos/pasarela_lenta", cuerpo);

        assertThat(respuesta.statusCode()).isEqualTo(413);
        assertThat(respuesta.body()).contains("\"error\":\"cuerpo_demasiado_grande\"", "4 KB");
        assertThat(estado.vigente(EstadoDeCaos.PASARELA_LENTA)).isEmpty();
    }

    @Test
    void caosNoDejaLineaDePeticionPeroSiUnaPorCadaCambio(CapturedOutput salida) throws Exception {
        caos("PUT", "/caos/pasarela_errores", "{\"porcentaje\":50,\"metodo\":\"oxxo\"}");
        caos("GET", "/caos", null);
        pedir("GET", "/caos", null, null);
        caos("DELETE", "/caos", null);

        assertThat(salida.getOut()).doesNotContain("peticion atendida");
        assertThat(salida.getOut())
                .containsOnlyOnce("\"msg\":\"caos activado\"")
                .containsOnlyOnce("\"msg\":\"caos apagado\"")
                .contains("\"chaos_type\":\"pasarela_errores\"", "\"params\":{\"porcentaje\":50,\"metodo\":\"oxxo\"}");
    }

    @Test
    void elCaosNoTocaSaludNiElRestoDeLaApi() throws Exception {
        when(pedidos.obtener("PED-000001"))
                .thenReturn(new PedidoConsultado("PED-000001", true, new BigDecimal("275.50"), "2026-10-12T00:50:29Z"));
        when(pasarela.cobrar(any(), any())).thenReturn(ResultadoCobro.APROBADO);
        caos("PUT", "/caos/pasarela_lenta", "{\"ms\":10000}");
        caos("PUT", "/caos/pasarela_errores", "{}");

        assertThat(pedir("GET", "/salud", null, null).statusCode()).isEqualTo(200);
        assertThat(pedir("GET", "/pagos", null, null).statusCode()).isEqualTo(200);
        assertThat(caos("GET", "/caos", null).statusCode()).isEqualTo(200);
    }
}
