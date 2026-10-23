package mx.tianguis.pagos.dominio;

import java.util.Arrays;
import java.util.Optional;

/** Estado con el que quedó guardado un pago. */
public enum EstadoPago {
    APROBADO("aprobado"),
    RECHAZADO("rechazado"),
    ERROR_PASARELA("error_pasarela");

    private final String codigo;

    EstadoPago(String codigo) {
        this.codigo = codigo;
    }

    /**
     * Código con el que el estado viaja en la API.
     *
     * @return el código en minúsculas
     */
    public String codigo() {
        return codigo;
    }

    /**
     * Busca un estado por su código exacto.
     *
     * @param codigo el código recibido
     * @return el estado, o vacío si no existe
     */
    public static Optional<EstadoPago> desdeCodigo(String codigo) {
        return Arrays.stream(values()).filter(estado -> estado.codigo.equals(codigo)).findFirst();
    }
}
