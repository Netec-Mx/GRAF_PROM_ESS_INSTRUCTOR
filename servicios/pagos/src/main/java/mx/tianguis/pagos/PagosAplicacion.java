package mx.tianguis.pagos;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/** Punto de entrada del servicio pagos. */
@SpringBootApplication
public class PagosAplicacion {

    /**
     * Arranca el servicio.
     *
     * @param args argumentos de la línea de comandos
     */
    public static void main(String[] args) {
        SpringApplication.run(PagosAplicacion.class, args);
    }
}
