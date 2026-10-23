package mx.tianguis.pagos.aplicacion;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import mx.tianguis.pagos.dominio.EstadoPago;
import mx.tianguis.pagos.dominio.MetodoPago;
import mx.tianguis.pagos.dominio.Pago;
import mx.tianguis.pagos.dominio.PagoEnCursoException;
import mx.tianguis.pagos.dominio.PagoNoEncontradoException;
import mx.tianguis.pagos.dominio.PedidoNoConfirmadoException;
import mx.tianguis.pagos.dominio.PedidoNoEncontradoException;
import mx.tianguis.pagos.dominio.PedidoYaPagadoException;
import mx.tianguis.pagos.dominio.SolicitudInvalidaException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.NullSource;
import org.junit.jupiter.params.provider.ValueSource;

/** Los 7 resultados del punto 4, con PedidosPort y PasarelaPort falsos (Mockito). */
class ProcesarPagoTest {

    private static final String PEDIDO = "PED-000001";
    private static final BigDecimal TOTAL = new BigDecimal("275.50");
    private static final String CREADO = "2026-10-12T00:50:29Z";

    private PedidosPort pedidos;
    private PasarelaPort pasarela;
    private RepositorioFalso repositorio;
    private ObservadorDePagos observador;
    private ProcesarPago procesarPago;

    /** Repositorio mínimo en memoria, solo para estas pruebas. */
    private static final class RepositorioFalso implements RepositorioDePagos {

        private final List<Pago> pagos = new ArrayList<>();

        private final Set<String> pagados = new HashSet<>();

        @Override
        public Pago guardar(PedidoConsultado pedido, MetodoPago metodo, EstadoPago estado) {
            Pago pago = new Pago(String.format("PAG-%06d", pagos.size() + 1), pedido.id(), pedido.total(), metodo, estado, pedido.creadoEn());
            pagos.add(pago);
            if (pago.aprobado()) {
                pagados.add(pedido.clave());
            }
            return pago;
        }

        @Override
        public Optional<Pago> obtener(String id) {
            return pagos.stream().filter(pago -> pago.id().equals(id)).findFirst();
        }

        @Override
        public List<Pago> listar() {
            return List.copyOf(pagos);
        }

        @Override
        public boolean tieneAprobado(PedidoConsultado pedido) {
            return pagados.contains(pedido.clave());
        }
    }

    @BeforeEach
    void preparar() {
        pedidos = mock(PedidosPort.class);
        pasarela = mock(PasarelaPort.class);
        observador = mock(ObservadorDePagos.class);
        repositorio = new RepositorioFalso();
        procesarPago = new ProcesarPago(pedidos, pasarela, repositorio, observador);
        when(pedidos.obtener(PEDIDO)).thenReturn(new PedidoConsultado(PEDIDO, true, TOTAL, CREADO));
    }

    @Test
    void resultado1PedidoNoExiste() {
        when(pedidos.obtener("PED-000404")).thenThrow(new PedidoNoEncontradoException("PED-000404"));

        assertThatThrownBy(() -> procesarPago.procesar("PED-000404", "tarjeta"))
                .isInstanceOf(PedidoNoEncontradoException.class);

        nadaSeCobroNiSeGuardo();
    }

    @Test
    void resultado2PedidoNoConfirmado() {
        when(pedidos.obtener(PEDIDO)).thenReturn(new PedidoConsultado(PEDIDO, false, new BigDecimal("0.00"), CREADO));

        assertThatThrownBy(() -> procesarPago.procesar(PEDIDO, "tarjeta"))
                .isInstanceOf(PedidoNoConfirmadoException.class);

        nadaSeCobroNiSeGuardo();
    }

    @Test
    void resultado3PedidoYaTieneUnPagoAprobado() {
        when(pasarela.cobrar(MetodoPago.TARJETA, TOTAL)).thenReturn(ResultadoCobro.APROBADO);
        procesarPago.procesar(PEDIDO, "tarjeta");

        assertThatThrownBy(() -> procesarPago.procesar(PEDIDO, "spei")).isInstanceOf(PedidoYaPagadoException.class);

        assertThat(repositorio.pagos).hasSize(1);
        verify(pasarela, never()).cobrar(MetodoPago.SPEI, TOTAL);
    }

    @Test
    void resultado4PedidosNoResponde() {
        when(pedidos.obtener(PEDIDO)).thenThrow(new PedidosNoDisponibleException("sin conexión", null));

        assertThatThrownBy(() -> procesarPago.procesar(PEDIDO, "tarjeta"))
                .isInstanceOf(PedidosNoDisponibleException.class);

        nadaSeCobroNiSeGuardo();
    }

    @ParameterizedTest
    @CsvSource({
        "APROBADO, APROBADO, approved", // resultado 5
        "RECHAZADO_POR_FONDOS, RECHAZADO, declined", // resultado 6
        "ERROR, ERROR_PASARELA, gateway_error" // resultado 7
    })
    void resultados5a7SegunLoQueRespondeLaPasarela(ResultadoCobro cobro, EstadoPago estado, String codigo) {
        when(pasarela.cobrar(MetodoPago.OXXO, TOTAL)).thenReturn(cobro);

        PagoProcesado procesado = procesarPago.procesar(PEDIDO, "oxxo");

        Pago esperado = new Pago("PAG-000001", PEDIDO, TOTAL, MetodoPago.OXXO, estado, CREADO);
        assertThat(procesado.pago()).isEqualTo(esperado);
        assertThat(procesado.resultado().codigo()).isEqualTo(codigo);
        assertThat(repositorio.pagos).containsExactly(esperado);
        verify(observador).pagoProcesado(esperado, cobro);
    }

    @Test
    void elMontoSaleDelPedidoYNoDeQuienLlama() {
        when(pedidos.obtener("PED-000002")).thenReturn(new PedidoConsultado("PED-000002", true, new BigDecimal("99.99"), CREADO));
        when(pasarela.cobrar(any(), any())).thenReturn(ResultadoCobro.APROBADO);

        // procesar() ni siquiera recibe un monto: solo el id del pedido y el método.
        Pago pago = procesarPago.procesar("PED-000002", "spei").pago();

        assertThat(pago.monto()).isEqualTo(new BigDecimal("99.99"));
        verify(pasarela).cobrar(MetodoPago.SPEI, new BigDecimal("99.99"));
    }

    @Test
    void siPedidosSeReiniciaYReusaElIdElPedidoNuevoSePuedePagar() {
        when(pasarela.cobrar(any(), any())).thenReturn(ResultadoCobro.APROBADO);
        procesarPago.procesar(PEDIDO, "tarjeta");

        // Pedidos volvió a numerar desde PED-000001: mismo id, otro pedido, otra fecha y otro total.
        when(pedidos.obtener(PEDIDO))
                .thenReturn(new PedidoConsultado(PEDIDO, true, new BigDecimal("42.00"), "2026-10-12T03:00:00Z"));
        Pago delPedidoNuevo = procesarPago.procesar(PEDIDO, "spei").pago();

        assertThat(delPedidoNuevo.aprobado()).isTrue();
        assertThat(delPedidoNuevo.monto()).isEqualTo(new BigDecimal("42.00"));
        assertThatThrownBy(() -> procesarPago.procesar(PEDIDO, "spei")).isInstanceOf(PedidoYaPagadoException.class);
    }

    @Test
    void unPagoRechazadoSePuedeReintentar() {
        when(pasarela.cobrar(MetodoPago.TARJETA, TOTAL))
                .thenReturn(ResultadoCobro.RECHAZADO_POR_FONDOS, ResultadoCobro.ERROR, ResultadoCobro.APROBADO);

        procesarPago.procesar(PEDIDO, "tarjeta");
        procesarPago.procesar(PEDIDO, "tarjeta");
        Pago tercero = procesarPago.procesar(PEDIDO, "tarjeta").pago();

        assertThat(tercero.id()).isEqualTo("PAG-000003");
        assertThat(tercero.aprobado()).isTrue();
    }

    @ParameterizedTest
    @NullSource
    @ValueSource(strings = {"", "PED 1", "../salud", "PED-000001/x", "PED-0000000000000000000000000000001"})
    void unIdDePedidoInvalidoNoLlegaAPedidos(String pedidoId) {
        assertThatThrownBy(() -> procesarPago.procesar(pedidoId, "tarjeta"))
                .isInstanceOf(SolicitudInvalidaException.class);

        verifyNoInteractions(pedidos, pasarela, observador);
    }

    @ParameterizedTest
    @NullSource
    @ValueSource(strings = {"", "TARJETA", "efectivo"})
    void unMetodoDesconocidoNoLlegaAPedidos(String metodo) {
        assertThatThrownBy(() -> procesarPago.procesar(PEDIDO, metodo)).isInstanceOf(SolicitudInvalidaException.class);

        verifyNoInteractions(pedidos, pasarela, observador);
    }

    @Test
    void dosPagosSimultaneosDelMismoPedidoNoSeCobranLosDos() throws InterruptedException {
        CountDownLatch dentroDeLaPasarela = new CountDownLatch(1);
        CountDownLatch soltar = new CountDownLatch(1);
        when(pasarela.cobrar(MetodoPago.TARJETA, TOTAL)).thenAnswer(llamada -> {
            dentroDeLaPasarela.countDown();
            soltar.await(5, TimeUnit.SECONDS);
            return ResultadoCobro.APROBADO;
        });

        Thread primero = Thread.ofVirtual().start(() -> procesarPago.procesar(PEDIDO, "tarjeta"));
        assertThat(dentroDeLaPasarela.await(5, TimeUnit.SECONDS)).isTrue();

        assertThatThrownBy(() -> procesarPago.procesar(PEDIDO, "tarjeta")).isInstanceOf(PagoEnCursoException.class);

        soltar.countDown();
        primero.join();
        assertThat(repositorio.pagos).hasSize(1);
        assertThatThrownBy(() -> procesarPago.procesar(PEDIDO, "tarjeta")).isInstanceOf(PedidoYaPagadoException.class);
    }

    @Test
    void listarPagosFiltraPorEstado() {
        when(pedidos.obtener(any())).thenAnswer(llamada -> {
            String id = llamada.getArgument(0);
            return new PedidoConsultado(id, true, TOTAL, CREADO);
        });
        when(pasarela.cobrar(any(), any()))
                .thenReturn(ResultadoCobro.APROBADO, ResultadoCobro.RECHAZADO_POR_FONDOS, ResultadoCobro.APROBADO);
        procesarPago.procesar("PED-000001", "tarjeta");
        procesarPago.procesar("PED-000002", "tarjeta");
        procesarPago.procesar("PED-000003", "oxxo");
        ListarPagos listarPagos = new ListarPagos(repositorio);

        assertThat(listarPagos.listar(null)).extracting(Pago::id).containsExactly("PAG-000001", "PAG-000002", "PAG-000003");
        assertThat(listarPagos.listar("")).hasSize(3);
        assertThat(listarPagos.listar("aprobado")).extracting(Pago::id).containsExactly("PAG-000001", "PAG-000003");
        assertThat(listarPagos.listar("rechazado")).extracting(Pago::id).containsExactly("PAG-000002");
        assertThat(listarPagos.listar("error_pasarela")).isEmpty();
        assertThat(listarPagos.listar("inventado")).isEmpty();
        assertThat(listarPagos.listar("APROBADO")).isEmpty();
    }

    @Test
    void obtenerPagoDevuelveElPagoOAvisaQueNoExiste() {
        when(pasarela.cobrar(MetodoPago.TARJETA, TOTAL)).thenReturn(ResultadoCobro.APROBADO);
        Pago pago = procesarPago.procesar(PEDIDO, "tarjeta").pago();
        ObtenerPago obtenerPago = new ObtenerPago(repositorio);

        assertThat(obtenerPago.obtener("PAG-000001")).isEqualTo(pago);
        assertThatThrownBy(() -> obtenerPago.obtener("PAG-000099")).isInstanceOf(PagoNoEncontradoException.class);
    }

    private void nadaSeCobroNiSeGuardo() {
        assertThat(repositorio.pagos).isEmpty();
        verifyNoInteractions(pasarela, observador);
    }
}
