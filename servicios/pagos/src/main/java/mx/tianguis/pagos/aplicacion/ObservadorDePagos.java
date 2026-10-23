package mx.tianguis.pagos.aplicacion;

import mx.tianguis.pagos.dominio.Pago;

/** Recibe los hechos de negocio que luego se publican como métricas. */
public interface ObservadorDePagos {

    /**
     * Se llama una vez por cada pago que pasó por la pasarela.
     *
     * @param pago el pago guardado
     * @param resultado qué respondió la pasarela
     */
    void pagoProcesado(Pago pago, ResultadoCobro resultado);
}
