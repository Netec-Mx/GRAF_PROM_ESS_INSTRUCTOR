package mx.tianguis.pagos.api;

/**
 * Cuerpo de una respuesta de error.
 *
 * @param error código fijo, como pedido_no_encontrado
 * @param mensaje explicación para una persona
 */
public record ErrorRespuesta(String error, String mensaje) {}
