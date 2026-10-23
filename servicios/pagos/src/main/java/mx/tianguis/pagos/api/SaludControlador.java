package mx.tianguis.pagos.api;

import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/** Responde si el servicio está vivo. */
@RestController
public class SaludControlador {

    /** Ruta del chequeo de salud. No genera línea de log. */
    public static final String RUTA = "/salud";

    @GetMapping(RUTA)
    Map<String, String> salud() {
        return Map.of("estado", "ok");
    }
}
