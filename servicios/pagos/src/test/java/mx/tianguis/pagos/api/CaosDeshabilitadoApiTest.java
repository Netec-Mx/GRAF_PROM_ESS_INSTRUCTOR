package mx.tianguis.pagos.api;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.Map;
import mx.tianguis.pagos.aplicacion.PasarelaPort;
import mx.tianguis.pagos.aplicacion.PedidosPort;
import mx.tianguis.pagos.infraestructura.EstadoDeCaos;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/** Con CAOS_TOKEN vacío, que es el valor por defecto, /caos no existe. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = "pagos.caos.token=")
class CaosDeshabilitadoApiTest {

    private final HttpClient http = HttpClient.newHttpClient();

    @Value("${local.server.port}")
    private int puerto;

    @Autowired
    private EstadoDeCaos estado;

    @MockitoBean
    private PedidosPort pedidos;

    @MockitoBean
    private PasarelaPort pasarela;

    @ParameterizedTest
    @CsvSource({
        "GET, /caos",
        "PUT, /caos/pasarela_lenta",
        "DELETE, /caos/pasarela_lenta",
        "DELETE, /caos",
        "GET, /caos;x=1",
        "PUT, /%63aos/pasarela_lenta"
    })
    void conElTokenVacioCaosResponde404(String metodo, String ruta) throws Exception {
        for (String llave : new String[] {null, "", "cualquiera"}) {
            HttpRequest.Builder peticion = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + puerto + ruta))
                    .method(metodo, HttpRequest.BodyPublishers.ofString("{\"ms\":1500}"))
                    .header("Content-Type", "application/json");
            if (llave != null) {
                peticion.header(FiltroDeCaos.CABECERA, llave);
            }

            HttpResponse<String> respuesta = http.send(peticion.build(), HttpResponse.BodyHandlers.ofString());

            assertThat(respuesta.statusCode()).isEqualTo(404);
        }
        assertThat(estado.activas()).containsOnly(
                Map.entry("pasarela_lenta", false), Map.entry("pasarela_errores", false));
    }
}
