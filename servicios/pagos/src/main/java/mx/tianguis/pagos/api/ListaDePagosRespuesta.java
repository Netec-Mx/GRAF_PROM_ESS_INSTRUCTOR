package mx.tianguis.pagos.api;

import java.util.List;

/**
 * Lista de pagos tal como viaja en la API, envuelta igual que en catalogo y pedidos.
 *
 * @param total cuántos pagos trae la lista
 * @param pagos los pagos, del más antiguo al más nuevo
 */
public record ListaDePagosRespuesta(int total, List<PagoRespuesta> pagos) {

    /** Copia la lista para que la respuesta no cambie después de creada. */
    public ListaDePagosRespuesta {
        pagos = List.copyOf(pagos);
    }
}
