package mx.tianguis.pagos.aplicacion;

/** El servicio pedidos no respondió o respondió algo que no se puede usar. */
public final class PedidosNoDisponibleException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    /**
     * Crea el error.
     *
     * @param mensaje qué pasó
     * @param causa el error original, o null
     */
    public PedidosNoDisponibleException(String mensaje, Throwable causa) {
        super(mensaje, causa);
    }
}
