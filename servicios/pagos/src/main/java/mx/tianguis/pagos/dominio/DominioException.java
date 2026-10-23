package mx.tianguis.pagos.dominio;

/** Base de los errores de negocio de pagos. */
public abstract sealed class DominioException extends RuntimeException
        permits MontoInvalidoException,
                PagoEnCursoException,
                PagoNoEncontradoException,
                PedidoNoConfirmadoException,
                PedidoNoEncontradoException,
                PedidoYaPagadoException,
                SolicitudInvalidaException {

    private static final long serialVersionUID = 1L;

    /**
     * Crea el error con su mensaje.
     *
     * @param mensaje descripción para quien llama
     */
    protected DominioException(String mensaje) {
        super(mensaje);
    }
}
