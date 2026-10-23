package mx.tianguis.pagos.aplicacion;

import java.util.List;
import java.util.Optional;
import mx.tianguis.pagos.dominio.EstadoPago;
import mx.tianguis.pagos.dominio.MetodoPago;
import mx.tianguis.pagos.dominio.Pago;

/** Guarda y recupera pagos. */
public interface RepositorioDePagos {

    /**
     * Asigna el siguiente id y guarda el pago, por el total del pedido. Si el pago quedó
     * aprobado, el pedido queda marcado como pagado.
     *
     * @param pedido pedido que se pagó
     * @param metodo medio de pago
     * @param estado cómo terminó
     * @return el pago guardado, con su id
     */
    Pago guardar(PedidoConsultado pedido, MetodoPago metodo, EstadoPago estado);

    /**
     * Busca un pago por su id.
     *
     * @param id id del pago
     * @return el pago, o vacío
     */
    Optional<Pago> obtener(String id);

    /**
     * Devuelve los pagos que se conservan, del más antiguo al más nuevo.
     *
     * @return una copia de la lista de pagos
     */
    List<Pago> listar();

    /**
     * Indica si el pedido ya tiene un pago aprobado. Debe seguir respondiendo true aunque el
     * pago ya no se conserve.
     *
     * @param pedido el pedido
     * @return true si lo tiene
     */
    boolean tieneAprobado(PedidoConsultado pedido);
}
