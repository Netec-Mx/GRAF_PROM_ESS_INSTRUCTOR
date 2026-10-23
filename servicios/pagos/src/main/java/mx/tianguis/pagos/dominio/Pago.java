package mx.tianguis.pagos.dominio;

import java.math.BigDecimal;
import java.util.Objects;

/**
 * Un intento de pago ya resuelto por la pasarela.
 *
 * @param id identificador del pago, como PAG-000001
 * @param pedidoId pedido que se pagó
 * @param monto monto en pesos con dos decimales, tomado del total del pedido
 * @param metodo medio de pago
 * @param estado cómo terminó
 * @param pedidoCreadoEn fecha de creación del pedido, tal como la informa pedidos. Junto con
 *     pedidoId identifica al pedido: pedidos reusa los id al reiniciarse
 */
public record Pago(
        String id, String pedidoId, BigDecimal monto, MetodoPago metodo, EstadoPago estado, String pedidoCreadoEn) {

    /** Valida que el pago esté completo y que el monto tenga dos decimales y no sea negativo. */
    public Pago {
        Objects.requireNonNull(id, "id");
        Objects.requireNonNull(pedidoId, "pedidoId");
        Objects.requireNonNull(monto, "monto");
        Objects.requireNonNull(metodo, "metodo");
        Objects.requireNonNull(estado, "estado");
        Objects.requireNonNull(pedidoCreadoEn, "pedidoCreadoEn");
        if (monto.scale() != Montos.DECIMALES || monto.signum() < 0) {
            throw new MontoInvalidoException(monto.toPlainString());
        }
    }

    /**
     * Indica si el pago quedó aprobado.
     *
     * @return true si el estado es aprobado
     */
    public boolean aprobado() {
        return estado == EstadoPago.APROBADO;
    }
}
