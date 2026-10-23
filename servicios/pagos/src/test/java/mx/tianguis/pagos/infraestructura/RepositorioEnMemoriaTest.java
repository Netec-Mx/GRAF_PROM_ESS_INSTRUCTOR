package mx.tianguis.pagos.infraestructura;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import mx.tianguis.pagos.aplicacion.ObservadorDePagos;
import mx.tianguis.pagos.aplicacion.PasarelaPort;
import mx.tianguis.pagos.aplicacion.PedidoConsultado;
import mx.tianguis.pagos.aplicacion.PedidosPort;
import mx.tianguis.pagos.aplicacion.ProcesarPago;
import mx.tianguis.pagos.aplicacion.ResultadoCobro;
import mx.tianguis.pagos.dominio.EstadoPago;
import mx.tianguis.pagos.dominio.MetodoPago;
import mx.tianguis.pagos.dominio.Pago;
import mx.tianguis.pagos.dominio.PedidoYaPagadoException;
import org.junit.jupiter.api.Test;

class RepositorioEnMemoriaTest {

    private static final BigDecimal MONTO = new BigDecimal("10.00");

    private static PedidoConsultado pedido(int numero) {
        return new PedidoConsultado(String.format("PED-%06d", numero), true, MONTO, "2026-10-12T00:50:29Z");
    }

    @Test
    void asignaIdsSecuenciales() {
        RepositorioEnMemoria repositorio = new RepositorioEnMemoria(10, 10);

        Pago primero = repositorio.guardar(pedido(1), MetodoPago.TARJETA, EstadoPago.RECHAZADO);
        Pago segundo = repositorio.guardar(pedido(1), MetodoPago.SPEI, EstadoPago.APROBADO);

        assertThat(primero.id()).isEqualTo("PAG-000001");
        assertThat(segundo).isEqualTo(new Pago("PAG-000002", "PED-000001", MONTO, MetodoPago.SPEI, EstadoPago.APROBADO, "2026-10-12T00:50:29Z"));
        assertThat(repositorio.obtener("PAG-000002")).contains(segundo);
        assertThat(repositorio.obtener("PAG-000003")).isEmpty();
    }

    @Test
    void soloUnPagoAprobadoMarcaElPedidoComoPagado() {
        RepositorioEnMemoria repositorio = new RepositorioEnMemoria(10, 10);

        repositorio.guardar(pedido(1), MetodoPago.TARJETA, EstadoPago.RECHAZADO);
        repositorio.guardar(pedido(1), MetodoPago.TARJETA, EstadoPago.ERROR_PASARELA);
        assertThat(repositorio.tieneAprobado(pedido(1))).isFalse();

        repositorio.guardar(pedido(1), MetodoPago.TARJETA, EstadoPago.APROBADO);
        assertThat(repositorio.tieneAprobado(pedido(1))).isTrue();
        assertThat(repositorio.tieneAprobado(pedido(2))).isFalse();
    }

    @Test
    void alLlenarseDescartaElMasAntiguoPeroElPedidoSigueFigurandoComoPagado() {
        RepositorioEnMemoria repositorio = new RepositorioEnMemoria(3, 100);
        for (int i = 1; i <= 5; i++) {
            repositorio.guardar(pedido(i), MetodoPago.OXXO, EstadoPago.APROBADO);
        }

        assertThat(repositorio.listar()).extracting(Pago::id).containsExactly("PAG-000003", "PAG-000004", "PAG-000005");
        // Los pagos más antiguos ya no se pueden consultar...
        assertThat(repositorio.obtener("PAG-000001")).isEmpty();
        assertThat(repositorio.obtener("PAG-000002")).isEmpty();
        assertThat(repositorio.obtener("PAG-000003")).isPresent();
        assertThat(repositorio.obtener("PAG-000005")).isPresent();
        // ...pero sus pedidos siguen pagados: descartar el pago no borra la marca.
        for (int i = 1; i <= 5; i++) {
            assertThat(repositorio.tieneAprobado(pedido(i))).isTrue();
        }
    }

    @Test
    void unPedidoPagadoYDescartadoDelRepositorioNoSeCobraDosVeces() {
        PedidosPort pedidos = mock(PedidosPort.class);
        PasarelaPort pasarela = mock(PasarelaPort.class);
        when(pedidos.obtener(any())).thenAnswer(llamada -> {
            String id = llamada.getArgument(0);
            return new PedidoConsultado(id, true, MONTO, "2026-10-12T00:50:29Z");
        });
        when(pasarela.cobrar(any(), any())).thenReturn(ResultadoCobro.APROBADO);
        RepositorioEnMemoria repositorio = new RepositorioEnMemoria(3, 100);
        ProcesarPago procesarPago = new ProcesarPago(pedidos, pasarela, repositorio, mock(ObservadorDePagos.class));

        Pago primero = procesarPago.procesar("PED-000001", "tarjeta").pago();
        for (int i = 2; i <= 5; i++) {
            procesarPago.procesar(String.format("PED-%06d", i), "tarjeta");
        }

        assertThat(repositorio.obtener(primero.id())).isEmpty();
        assertThatThrownBy(() -> procesarPago.procesar("PED-000001", "tarjeta"))
                .isInstanceOf(PedidoYaPagadoException.class);
        verify(pasarela, times(5)).cobrar(any(), any());
    }

    @Test
    void elMismoIdConOtraFechaDeCreacionEsOtroPedido() {
        RepositorioEnMemoria repositorio = new RepositorioEnMemoria(10, 10);
        repositorio.guardar(pedido(1), MetodoPago.SPEI, EstadoPago.APROBADO);

        PedidoConsultado trasReiniciarPedidos = new PedidoConsultado("PED-000001", true, MONTO, "2026-10-12T03:00:00Z");

        assertThat(repositorio.tieneAprobado(pedido(1))).isTrue();
        assertThat(repositorio.tieneAprobado(trasReiniciarPedidos)).isFalse();
    }

    @Test
    void elConjuntoDePagadosTieneSuPropioTopeYOlvidaElMasAntiguo() {
        RepositorioEnMemoria repositorio = new RepositorioEnMemoria(2, 3);
        for (int i = 1; i <= 4; i++) {
            repositorio.guardar(pedido(i), MetodoPago.OXXO, EstadoPago.APROBADO);
        }

        assertThat(repositorio.tieneAprobado(pedido(1))).isFalse();
        assertThat(repositorio.tieneAprobado(pedido(2))).isTrue();
        assertThat(repositorio.tieneAprobado(pedido(4))).isTrue();
    }

    @Test
    void lasCapacidadesDebenSerMayoresQueCero() {
        assertThatThrownBy(() -> new RepositorioEnMemoria(0, 10)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new RepositorioEnMemoria(10, 0)).isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void soportaEscriturasConcurrentes() throws InterruptedException {
        RepositorioEnMemoria repositorio = new RepositorioEnMemoria(400, 400);
        Set<String> ids = ConcurrentHashMap.newKeySet();
        List<Thread> hilos = new ArrayList<>();

        for (int h = 0; h < 8; h++) {
            hilos.add(Thread.ofVirtual().start(() -> {
                for (int i = 0; i < 50; i++) {
                    ids.add(repositorio.guardar(pedido(1), MetodoPago.SPEI, EstadoPago.RECHAZADO).id());
                }
            }));
        }
        for (Thread hilo : hilos) {
            hilo.join();
        }

        assertThat(ids).hasSize(400).contains("PAG-000001", "PAG-000400");
    }
}
