package mx.tianguis.pagos.dominio;

import java.util.Arrays;
import java.util.Optional;

/** Medios con los que se puede pagar un pedido. */
public enum MetodoPago {
    TARJETA("tarjeta"),
    OXXO("oxxo"),
    SPEI("spei");

    private final String codigo;

    MetodoPago(String codigo) {
        this.codigo = codigo;
    }

    /**
     * Código con el que el método viaja en la API, en los logs y en las métricas.
     *
     * @return el código en minúsculas
     */
    public String codigo() {
        return codigo;
    }

    /**
     * Busca un método por su código exacto.
     *
     * @param codigo el código recibido
     * @return el método, o vacío si no existe
     */
    public static Optional<MetodoPago> desdeCodigo(String codigo) {
        return Arrays.stream(values()).filter(metodo -> metodo.codigo.equals(codigo)).findFirst();
    }
}
