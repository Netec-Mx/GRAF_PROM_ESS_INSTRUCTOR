package mx.tianguis.pagos.api;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * Cuerpo de POST /pagos. No trae monto: el monto sale del pedido.
 *
 * @param pedidoId id del pedido a pagar
 * @param metodo tarjeta, oxxo o spei
 */
public record SolicitudDePago(@JsonProperty("pedido_id") String pedidoId, @JsonProperty("metodo") String metodo) {}
