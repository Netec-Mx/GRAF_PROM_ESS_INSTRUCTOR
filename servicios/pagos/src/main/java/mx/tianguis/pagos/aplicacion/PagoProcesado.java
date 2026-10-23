package mx.tianguis.pagos.aplicacion;

import mx.tianguis.pagos.dominio.Pago;

/**
 * Resultado de procesar un pago.
 *
 * @param pago el pago guardado
 * @param resultado qué respondió la pasarela
 */
public record PagoProcesado(Pago pago, ResultadoCobro resultado) {}
