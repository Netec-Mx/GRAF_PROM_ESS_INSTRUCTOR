package mx.tianguis.pagos.aplicacion;

import mx.tianguis.pagos.dominio.Pago;
import mx.tianguis.pagos.dominio.PagoNoEncontradoException;

/** Caso de uso: consultar un pago por su id. */
public final class ObtenerPago {

    private final RepositorioDePagos repositorio;

    /**
     * Crea el caso de uso.
     *
     * @param repositorio dónde se guardan los pagos
     */
    public ObtenerPago(RepositorioDePagos repositorio) {
        this.repositorio = repositorio;
    }

    /**
     * Busca un pago.
     *
     * @param id id del pago
     * @return el pago
     * @throws PagoNoEncontradoException si no existe
     */
    public Pago obtener(String id) {
        return repositorio.obtener(id).orElseThrow(() -> new PagoNoEncontradoException(id));
    }
}
