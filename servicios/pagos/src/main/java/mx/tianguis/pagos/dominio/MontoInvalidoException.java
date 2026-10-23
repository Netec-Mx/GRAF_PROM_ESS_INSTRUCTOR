package mx.tianguis.pagos.dominio;

/** El monto no es un número con dos decimales. */
public final class MontoInvalidoException extends DominioException {

    private static final long serialVersionUID = 1L;

    /**
     * Crea el error.
     *
     * @param dato el texto recibido
     */
    public MontoInvalidoException(String dato) {
        super("Monto inválido: " + dato);
    }
}
