package mx.tianguis.pagos.infraestructura;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.math.BigDecimal;
import java.net.http.HttpClient;
import java.time.Duration;
import mx.tianguis.pagos.aplicacion.PedidoConsultado;
import mx.tianguis.pagos.aplicacion.PedidosNoDisponibleException;
import mx.tianguis.pagos.aplicacion.PedidosPort;
import mx.tianguis.pagos.dominio.DominioException;
import mx.tianguis.pagos.dominio.Montos;
import mx.tianguis.pagos.dominio.PedidoNoEncontradoException;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.web.client.RestClient;

/** Consulta el servicio pedidos por HTTP. */
public final class ClientePedidosHttp implements PedidosPort {

    private static final String ESTADO_CONFIRMADO = "confirmado";

    /** Una fecha en formato ISO ocupa unos 20 caracteres. Más que esto no es una fecha. */
    private static final int MAX_LARGO_DE_FECHA = 40;

    private final RestClient cliente;

    /**
     * El JSON de GET /pedidos/{id}. Solo los campos que pagos usa.
     *
     * @param id id del pedido
     * @param estado confirmado, rechazado_sku_inexistente o rechazado_sin_stock
     * @param totalMxn total como texto con dos decimales
     * @param creadoEn fecha de creación
     */
    record PedidoJson(
            String id,
            String estado,
            @JsonProperty("total_mxn") String totalMxn,
            @JsonProperty("creado_en") String creadoEn) {}

    /**
     * Crea el cliente.
     *
     * @param urlBase por ejemplo http://pedidos:8080
     * @param timeout tiempo máximo para conectar y para leer la respuesta
     */
    public ClientePedidosHttp(String urlBase, Duration timeout) {
        // pedidos no redirige. Si lo hiciera, no se sigue a ciegas.
        HttpClient http = HttpClient.newBuilder()
                .connectTimeout(timeout)
                .followRedirects(HttpClient.Redirect.NEVER)
                .build();
        JdkClientHttpRequestFactory fabrica = new JdkClientHttpRequestFactory(http);
        fabrica.setReadTimeout(timeout);
        this.cliente = RestClient.builder().baseUrl(urlBase).requestFactory(fabrica).build();
    }

    @Override
    public PedidoConsultado obtener(String pedidoId) {
        try {
            return cliente.get()
                    .uri("/pedidos/{id}", pedidoId)
                    .accept(MediaType.APPLICATION_JSON)
                    .exchange((peticion, respuesta) -> {
                        int codigo = respuesta.getStatusCode().value();
                        if (codigo == HttpStatus.NOT_FOUND.value()) {
                            throw new PedidoNoEncontradoException(pedidoId);
                        }
                        if (codigo != HttpStatus.OK.value()) {
                            throw new PedidosNoDisponibleException("pedidos respondió " + codigo, null);
                        }
                        return aPedido(pedidoId, respuesta.bodyTo(PedidoJson.class));
                    });
        } catch (PedidoNoEncontradoException | PedidosNoDisponibleException e) {
            throw e;
        } catch (RuntimeException e) {
            // Sin conexión, timeout o un cuerpo que no se puede leer.
            throw new PedidosNoDisponibleException("pedidos no respondió: " + e.getMessage(), e);
        }
    }

    private static PedidoConsultado aPedido(String pedidoId, PedidoJson cuerpo) {
        if (cuerpo == null
                || !pedidoId.equals(cuerpo.id())
                || cuerpo.estado() == null
                || cuerpo.creadoEn() == null
                || cuerpo.creadoEn().isBlank()
                || cuerpo.creadoEn().length() > MAX_LARGO_DE_FECHA) {
            throw new PedidosNoDisponibleException("respuesta inconsistente de pedidos para " + pedidoId, null);
        }
        BigDecimal total;
        try {
            total = Montos.desdeTexto(cuerpo.totalMxn());
        } catch (DominioException e) {
            throw new PedidosNoDisponibleException("total_mxn ilegible en la respuesta de pedidos", e);
        }
        return new PedidoConsultado(cuerpo.id(), ESTADO_CONFIRMADO.equals(cuerpo.estado()), total, cuerpo.creadoEn());
    }
}
