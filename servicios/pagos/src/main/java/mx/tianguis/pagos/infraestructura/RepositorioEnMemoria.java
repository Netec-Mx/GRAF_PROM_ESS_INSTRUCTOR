package mx.tianguis.pagos.infraestructura;

import java.util.ArrayDeque;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import mx.tianguis.pagos.aplicacion.PedidoConsultado;
import mx.tianguis.pagos.aplicacion.RepositorioDePagos;
import mx.tianguis.pagos.dominio.EstadoPago;
import mx.tianguis.pagos.dominio.MetodoPago;
import mx.tianguis.pagos.dominio.Pago;

/**
 * Guarda los pagos en memoria. Se pierden al reiniciar el servicio.
 *
 * <p>Lleva dos cosas con topes distintos:
 *
 * <ul>
 *   <li>Los pagos, para consultarlos. Conserva solo los últimos; al superar su capacidad
 *       descarta el más antiguo.
 *   <li>Los pedidos ya pagados, para no cobrarlos dos veces. Es un conjunto aparte que no se
 *       vacía al descartar pagos, con un tope mucho más alto.
 * </ul>
 */
public final class RepositorioEnMemoria implements RepositorioDePagos {

    /** Cuántos pagos se conservan, igual que el tope de pedidos. */
    public static final int CAPACIDAD_POR_DEFECTO = 1000;

    /** Cuántos pedidos pagados se recuerdan. Cada uno ocupa unas decenas de bytes. */
    public static final int CAPACIDAD_DE_PAGADOS_POR_DEFECTO = 100_000;

    private final int capacidad;
    private final int capacidadDePagados;
    private final ArrayDeque<String> orden = new ArrayDeque<>();
    private final Map<String, Pago> pagos = new HashMap<>();
    private final LinkedHashSet<String> pedidosPagados = new LinkedHashSet<>();
    private long siguiente = 1;

    /**
     * Crea un repositorio vacío.
     *
     * @param capacidad cuántos pagos conserva; debe ser mayor que cero
     * @param capacidadDePagados cuántos pedidos pagados recuerda; debe ser mayor que cero
     */
    public RepositorioEnMemoria(int capacidad, int capacidadDePagados) {
        if (capacidad < 1 || capacidadDePagados < 1) {
            throw new IllegalArgumentException("las capacidades deben ser mayores que cero");
        }
        this.capacidad = capacidad;
        this.capacidadDePagados = capacidadDePagados;
    }

    @Override
    public synchronized Pago guardar(PedidoConsultado pedido, MetodoPago metodo, EstadoPago estado) {
        Pago pago = new Pago(String.format("PAG-%06d", siguiente), pedido.id(), pedido.total(), metodo, estado, pedido.creadoEn());
        siguiente++;
        if (orden.size() >= capacidad) {
            // Se descarta el pago, no la marca de pedido pagado.
            pagos.remove(orden.removeFirst());
        }
        orden.addLast(pago.id());
        pagos.put(pago.id(), pago);
        if (pago.aprobado()) {
            marcarPagado(pedido.clave());
        }
        return pago;
    }

    private void marcarPagado(String clave) {
        if (pedidosPagados.size() >= capacidadDePagados && !pedidosPagados.contains(clave)) {
            pedidosPagados.removeFirst();
        }
        pedidosPagados.add(clave);
    }

    @Override
    public synchronized Optional<Pago> obtener(String id) {
        return Optional.ofNullable(pagos.get(id));
    }

    @Override
    public synchronized List<Pago> listar() {
        return orden.stream().map(pagos::get).toList();
    }

    @Override
    public synchronized boolean tieneAprobado(PedidoConsultado pedido) {
        return pedidosPagados.contains(pedido.clave());
    }
}
