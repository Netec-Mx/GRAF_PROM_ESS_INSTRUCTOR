package mx.tianguis.pagos.aplicacion;

import java.math.BigDecimal;

/**
 * Lo que pagos necesita saber de un pedido.
 *
 * @param id identificador del pedido
 * @param confirmado si el pedido está confirmado
 * @param total total del pedido en pesos, con dos decimales
 * @param creadoEn fecha de creación tal como la informa pedidos
 */
public record PedidoConsultado(String id, boolean confirmado, BigDecimal total, String creadoEn) {

    /**
     * Identidad del pedido para saber si ya se pagó: su id más su fecha de creación.
     *
     * <p>El id solo no alcanza. Pedidos guarda en memoria y al reiniciarse vuelve a numerar
     * desde PED-000001, así que el mismo id puede nombrar a dos pedidos distintos.
     *
     * @return la clave del pedido
     */
    public String clave() {
        return id + "@" + creadoEn;
    }
}
