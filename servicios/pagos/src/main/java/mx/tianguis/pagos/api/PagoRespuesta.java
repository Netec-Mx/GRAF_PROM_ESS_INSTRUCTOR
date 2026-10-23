package mx.tianguis.pagos.api;

import com.fasterxml.jackson.annotation.JsonProperty;
import mx.tianguis.pagos.dominio.Montos;
import mx.tianguis.pagos.dominio.Pago;

/**
 * Un pago tal como viaja en la API.
 *
 * @param id id del pago
 * @param pedidoId id del pedido
 * @param pedidoCreadoEn fecha de creación del pedido; con pedidoId identifica al pedido
 * @param montoMxn monto como texto con dos decimales
 * @param metodo tarjeta, oxxo o spei
 * @param estado aprobado, rechazado o error_pasarela
 */
public record PagoRespuesta(
        @JsonProperty("id") String id,
        @JsonProperty("pedido_id") String pedidoId,
        @JsonProperty("pedido_creado_en") String pedidoCreadoEn,
        @JsonProperty("monto_mxn") String montoMxn,
        @JsonProperty("metodo") String metodo,
        @JsonProperty("estado") String estado) {

    static PagoRespuesta de(Pago pago) {
        return new PagoRespuesta(
                pago.id(),
                pago.pedidoId(),
                pago.pedidoCreadoEn(),
                Montos.aTexto(pago.monto()),
                pago.metodo().codigo(),
                pago.estado().codigo());
    }
}
