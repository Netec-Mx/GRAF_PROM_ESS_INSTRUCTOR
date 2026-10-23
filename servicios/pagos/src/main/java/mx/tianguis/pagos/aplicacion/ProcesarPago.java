package mx.tianguis.pagos.aplicacion;

import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Pattern;
import mx.tianguis.pagos.dominio.MetodoPago;
import mx.tianguis.pagos.dominio.Pago;
import mx.tianguis.pagos.dominio.PagoEnCursoException;
import mx.tianguis.pagos.dominio.PedidoNoConfirmadoException;
import mx.tianguis.pagos.dominio.PedidoYaPagadoException;
import mx.tianguis.pagos.dominio.SolicitudInvalidaException;

/**
 * Caso de uso: pagar un pedido.
 *
 * <p>El monto nunca llega de quien llama. Sale del total del pedido, que se consulta al
 * servicio pedidos.
 */
public final class ProcesarPago {

    /** Letras, dígitos y guiones: un id así no puede alterar la URL con la que se consulta a pedidos. */
    private static final Pattern ID_DE_PEDIDO = Pattern.compile("[A-Za-z0-9-]{1,32}");

    private final PedidosPort pedidos;
    private final PasarelaPort pasarela;
    private final RepositorioDePagos repositorio;
    private final ObservadorDePagos observador;
    private final Set<String> pedidosEnCurso = ConcurrentHashMap.newKeySet();

    /**
     * Crea el caso de uso.
     *
     * @param pedidos consulta al servicio pedidos
     * @param pasarela pasarela de cobro
     * @param repositorio dónde se guardan los pagos
     * @param observador quién publica las métricas de negocio
     */
    public ProcesarPago(
            PedidosPort pedidos, PasarelaPort pasarela, RepositorioDePagos repositorio, ObservadorDePagos observador) {
        this.pedidos = pedidos;
        this.pasarela = pasarela;
        this.repositorio = repositorio;
        this.observador = observador;
    }

    /**
     * Paga un pedido.
     *
     * @param pedidoId id del pedido
     * @param codigoDeMetodo tarjeta, oxxo o spei
     * @return el pago guardado y lo que respondió la pasarela
     * @throws SolicitudInvalidaException si el id o el método no son válidos
     * @throws mx.tianguis.pagos.dominio.PedidoNoEncontradoException si el pedido no existe
     * @throws PedidoNoConfirmadoException si el pedido no está confirmado
     * @throws PedidoYaPagadoException si el pedido ya tiene un pago aprobado
     * @throws PagoEnCursoException si se está procesando otro pago del mismo pedido
     * @throws PedidosNoDisponibleException si el servicio pedidos no responde
     */
    public PagoProcesado procesar(String pedidoId, String codigoDeMetodo) {
        if (pedidoId == null || !ID_DE_PEDIDO.matcher(pedidoId).matches()) {
            throw new SolicitudInvalidaException("pedido_id es obligatorio y solo admite letras, dígitos y guiones");
        }
        MetodoPago metodo = MetodoPago.desdeCodigo(codigoDeMetodo)
                .orElseThrow(() -> new SolicitudInvalidaException("metodo debe ser tarjeta, oxxo o spei"));

        // Dos pagos simultáneos del mismo pedido no pueden quedar aprobados los dos.
        if (!pedidosEnCurso.add(pedidoId)) {
            throw new PagoEnCursoException(pedidoId);
        }
        try {
            PedidoConsultado pedido = pedidos.obtener(pedidoId);
            if (!pedido.confirmado()) {
                throw new PedidoNoConfirmadoException(pedidoId);
            }
            if (repositorio.tieneAprobado(pedido)) {
                throw new PedidoYaPagadoException(pedidoId);
            }
            ResultadoCobro resultado = pasarela.cobrar(metodo, pedido.total());
            Pago pago = repositorio.guardar(pedido, metodo, resultado.estado());
            observador.pagoProcesado(pago, resultado);
            return new PagoProcesado(pago, resultado);
        } finally {
            pedidosEnCurso.remove(pedidoId);
        }
    }
}
