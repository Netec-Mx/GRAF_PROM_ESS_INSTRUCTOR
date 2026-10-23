package mx.tianguis.pagos.aplicacion;

import java.util.List;
import mx.tianguis.pagos.dominio.EstadoPago;
import mx.tianguis.pagos.dominio.Pago;

/** Caso de uso: listar los pagos que se conservan, con filtro opcional por estado. */
public final class ListarPagos {

    private final RepositorioDePagos repositorio;

    /**
     * Crea el caso de uso.
     *
     * @param repositorio dónde se guardan los pagos
     */
    public ListarPagos(RepositorioDePagos repositorio) {
        this.repositorio = repositorio;
    }

    /**
     * Lista los pagos, del más antiguo al más nuevo.
     *
     * @param codigoDeEstado aprobado, rechazado o error_pasarela; null o vacío para todos
     * @return los pagos; lista vacía si el estado no existe
     */
    public List<Pago> listar(String codigoDeEstado) {
        List<Pago> todos = repositorio.listar();
        if (codigoDeEstado == null || codigoDeEstado.isEmpty()) {
            return todos;
        }
        return EstadoPago.desdeCodigo(codigoDeEstado)
                .map(estado -> todos.stream().filter(pago -> pago.estado() == estado).toList())
                .orElse(List.of());
    }
}
