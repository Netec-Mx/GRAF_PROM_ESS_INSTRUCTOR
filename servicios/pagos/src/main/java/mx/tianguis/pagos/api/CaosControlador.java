package mx.tianguis.pagos.api;

import java.util.List;
import java.util.Map;
import mx.tianguis.pagos.infraestructura.EstadoDeCaos;
import mx.tianguis.pagos.infraestructura.EstadoDeCaos.Descripcion;
import mx.tianguis.pagos.infraestructura.EstadoDeCaos.FallaDesconocidaException;
import mx.tianguis.pagos.infraestructura.EstadoDeCaos.ParametrosInvalidosException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/**
 * Rutas de /caos: ver, encender y apagar las fallas del servicio.
 *
 * <p>El token lo revisa {@link FiltroDeCaos} antes de que la petición llegue aquí.
 */
@RestController
public class CaosControlador {

    /** Ruta base del caos. No genera línea de log de petición. */
    public static final String RUTA = "/caos";

    private final EstadoDeCaos estado;

    /**
     * Estado de todas las fallas.
     *
     * @param servicio nombre del servicio
     * @param fallas una descripción por tipo
     */
    record EstadoRespuesta(String servicio, List<Descripcion> fallas) {}

    CaosControlador(EstadoDeCaos estado) {
        this.estado = estado;
    }

    @GetMapping(RUTA)
    EstadoRespuesta ver() {
        return new EstadoRespuesta(FormatoDeLogs.SERVICIO, estado.resumen());
    }

    @PutMapping(RUTA + "/{tipo}")
    Descripcion activar(@PathVariable("tipo") String tipo, @RequestBody(required = false) Map<String, Object> cuerpo) {
        estado.activar(tipo, cuerpo);
        return estado.describir(tipo);
    }

    @DeleteMapping(RUTA + "/{tipo}")
    Descripcion apagar(@PathVariable("tipo") String tipo) {
        estado.apagar(tipo);
        return estado.describir(tipo);
    }

    @DeleteMapping(RUTA)
    EstadoRespuesta apagarTodo() {
        estado.apagarTodo();
        return ver();
    }

    @ExceptionHandler(FallaDesconocidaException.class)
    ResponseEntity<ErrorRespuesta> fallaDesconocida(FallaDesconocidaException error) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(new ErrorRespuesta("falla_desconocida", error.getMessage()));
    }

    @ExceptionHandler(ParametrosInvalidosException.class)
    ResponseEntity<ErrorRespuesta> parametrosInvalidos(ParametrosInvalidosException error) {
        return ResponseEntity.badRequest().body(new ErrorRespuesta("parametros_invalidos", error.getMessage()));
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    ResponseEntity<ErrorRespuesta> cuerpoIlegible(HttpMessageNotReadableException error) {
        if (error.getMostSpecificCause() instanceof LimiteDeCuerpo.CuerpoDemasiadoGrandeException demasiado) {
            return ResponseEntity.status(HttpStatus.CONTENT_TOO_LARGE)
                    .body(new ErrorRespuesta("cuerpo_demasiado_grande", demasiado.getMessage()));
        }
        return ResponseEntity.badRequest()
                .body(new ErrorRespuesta("parametros_invalidos", "El cuerpo debe ser un objeto JSON"));
    }
}
