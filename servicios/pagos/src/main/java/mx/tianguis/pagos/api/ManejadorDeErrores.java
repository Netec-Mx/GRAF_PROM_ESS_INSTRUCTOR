package mx.tianguis.pagos.api;

import mx.tianguis.pagos.aplicacion.PedidosNoDisponibleException;
import mx.tianguis.pagos.dominio.DominioException;
import mx.tianguis.pagos.dominio.MontoInvalidoException;
import mx.tianguis.pagos.dominio.PagoEnCursoException;
import mx.tianguis.pagos.dominio.PagoNoEncontradoException;
import mx.tianguis.pagos.dominio.PedidoNoConfirmadoException;
import mx.tianguis.pagos.dominio.PedidoNoEncontradoException;
import mx.tianguis.pagos.dominio.PedidoYaPagadoException;
import mx.tianguis.pagos.dominio.SolicitudInvalidaException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.ErrorResponse;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/** Convierte cada error en una respuesta JSON con su código HTTP. */
@RestControllerAdvice
public class ManejadorDeErrores {

    private static final Logger LOG = LoggerFactory.getLogger(ManejadorDeErrores.class);

    @ExceptionHandler(DominioException.class)
    ResponseEntity<ErrorRespuesta> dominio(DominioException error) {
        return switch (error) {
            case SolicitudInvalidaException e -> responder(HttpStatus.BAD_REQUEST, "solicitud_invalida", e.getMessage());
            case PedidoNoEncontradoException e -> responder(HttpStatus.NOT_FOUND, "pedido_no_encontrado", e.getMessage());
            case PagoNoEncontradoException e -> responder(HttpStatus.NOT_FOUND, "pago_no_encontrado", e.getMessage());
            case PedidoNoConfirmadoException e -> responder(HttpStatus.CONFLICT, "pedido_no_confirmado", e.getMessage());
            case PedidoYaPagadoException e -> responder(HttpStatus.CONFLICT, "pedido_ya_pagado", e.getMessage());
            case PagoEnCursoException e -> responder(HttpStatus.CONFLICT, "pago_en_curso", e.getMessage());
            case MontoInvalidoException e -> interno(e);
        };
    }

    @ExceptionHandler(PedidosNoDisponibleException.class)
    ResponseEntity<ErrorRespuesta> pedidosNoDisponible(PedidosNoDisponibleException error) {
        LOG.atError().addKeyValue("error", error.getMessage()).log("pedidos no disponible");
        return responder(
                HttpStatus.SERVICE_UNAVAILABLE,
                "pedidos_no_disponible",
                "No se pudo consultar el pedido. El pago no se procesó; inténtalo de nuevo.");
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    ResponseEntity<ErrorRespuesta> cuerpoIlegible(HttpMessageNotReadableException error) {
        if (error.getMostSpecificCause() instanceof LimiteDeCuerpo.CuerpoDemasiadoGrandeException demasiado) {
            return responder(HttpStatus.CONTENT_TOO_LARGE, "cuerpo_demasiado_grande", demasiado.getMessage());
        }
        return responder(
                HttpStatus.BAD_REQUEST,
                "solicitud_invalida",
                "El cuerpo debe ser un JSON como {\"pedido_id\":\"PED-000001\",\"metodo\":\"tarjeta\"}");
    }

    @ExceptionHandler(Exception.class)
    ResponseEntity<ErrorRespuesta> otros(Exception error) {
        // Errores propios de Spring MVC: ruta inexistente (404), método no permitido (405), etc.
        if (error instanceof ErrorResponse respuesta) {
            return responder(respuesta.getStatusCode(), "error_http", "La petición no se pudo atender");
        }
        return interno(error);
    }

    private static ResponseEntity<ErrorRespuesta> interno(Exception error) {
        LOG.atError().setCause(error).log("error interno");
        return responder(HttpStatus.INTERNAL_SERVER_ERROR, "error_interno", "Error interno del servicio");
    }

    private static ResponseEntity<ErrorRespuesta> responder(HttpStatusCode estado, String codigo, String mensaje) {
        return ResponseEntity.status(estado).body(new ErrorRespuesta(codigo, mensaje));
    }
}
