package mx.tianguis.pagos;

import io.opentelemetry.api.GlobalOpenTelemetry;
import io.opentelemetry.api.OpenTelemetry;
import io.opentelemetry.api.metrics.ObservableLongGauge;
import java.time.Duration;
import java.time.InstantSource;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ThreadLocalRandom;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;
import java.util.random.RandomGenerator;
import mx.tianguis.pagos.aplicacion.ListarPagos;
import mx.tianguis.pagos.aplicacion.ObservadorDePagos;
import mx.tianguis.pagos.aplicacion.ObtenerPago;
import mx.tianguis.pagos.aplicacion.PasarelaPort;
import mx.tianguis.pagos.aplicacion.PedidosPort;
import mx.tianguis.pagos.aplicacion.ProcesarPago;
import mx.tianguis.pagos.aplicacion.RepositorioDePagos;
import mx.tianguis.pagos.infraestructura.ClientePedidosHttp;
import mx.tianguis.pagos.infraestructura.EstadoDeCaos;
import mx.tianguis.pagos.infraestructura.PasarelaConCaos;
import mx.tianguis.pagos.infraestructura.PasarelaSimulada;
import mx.tianguis.pagos.infraestructura.PasarelaTrazada;
import mx.tianguis.pagos.infraestructura.RepositorioEnMemoria;
import mx.tianguis.pagos.telemetria.MetricasDeCaos;
import mx.tianguis.pagos.telemetria.MetricasDePagos;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Arma la aplicación: conecta los casos de uso con sus adaptadores.
 *
 * <p>Los casos de uso no llevan anotaciones de Spring; se declaran aquí.
 */
@Configuration(proxyBeanMethods = false)
public class Configuracion {

    /**
     * OpenTelemetry del proceso. Con el agente es su SDK; sin el agente no hace nada.
     *
     * @return la instancia global
     */
    @Bean
    OpenTelemetry openTelemetry() {
        return GlobalOpenTelemetry.get();
    }

    @Bean
    PedidosPort pedidosPort(
            @Value("${pagos.pedidos.url}") String url, @Value("${pagos.pedidos.timeout}") Duration timeout) {
        return new ClientePedidosHttp(url, timeout);
    }

    /**
     * Estado de las fallas de caos. Existe siempre; si CAOS_TOKEN está vacío nadie lo puede
     * cambiar y todo queda apagado.
     *
     * @return el estado, con todo apagado
     */
    @Bean
    EstadoDeCaos estadoDeCaos() {
        return new EstadoDeCaos(InstantSource.system());
    }

    /**
     * Revisa cada segundo si venció alguna falla, para apagarla y dejarlo en el log.
     *
     * @param estado el estado de caos
     * @return el planificador, que Spring detiene al apagar
     */
    @Bean(destroyMethod = "shutdownNow")
    ScheduledExecutorService barredorDeCaos(EstadoDeCaos estado) {
        ScheduledExecutorService barredor = Executors.newSingleThreadScheduledExecutor(
                Thread.ofPlatform().daemon().name("barredor-de-caos").factory());
        barredor.scheduleAtFixedRate(estado::barrer, 1, 1, TimeUnit.SECONDS);
        return barredor;
    }

    @Bean
    ObservableLongGauge metricaDeCaos(OpenTelemetry openTelemetry, EstadoDeCaos estado) {
        return MetricasDeCaos.publicar(openTelemetry.getMeter(MetricasDePagos.NOMBRE_DEL_MEDIDOR), estado::activas);
    }

    @Bean
    PasarelaPort pasarelaPort(EstadoDeCaos estado) {
        return armarPasarela(estado, ThreadLocalRandom::current, PasarelaSimulada.PAUSA_REAL);
    }

    /**
     * Arma la pasarela con sus decoradores. De afuera hacia adentro: el span pasarela.cobrar, las
     * fallas de caos y la pasarela simulada.
     *
     * @param estado qué fallas de caos están encendidas
     * @param azar de dónde sale el generador de números al azar
     * @param pausa cómo se esperan las demoras
     * @return la pasarela lista para usar
     */
    static PasarelaPort armarPasarela(
            EstadoDeCaos estado, Supplier<RandomGenerator> azar, PasarelaSimulada.Pausa pausa) {
        return new PasarelaTrazada(new PasarelaConCaos(new PasarelaSimulada(azar, pausa), estado, azar, pausa));
    }

    @Bean
    RepositorioDePagos repositorioDePagos(
            @Value("${pagos.repositorio.capacidad}") int capacidad,
            @Value("${pagos.repositorio.capacidad-de-pagados}") int capacidadDePagados) {
        return new RepositorioEnMemoria(capacidad, capacidadDePagados);
    }

    @Bean
    ObservadorDePagos observadorDePagos(OpenTelemetry openTelemetry) {
        return new MetricasDePagos(openTelemetry.getMeter(MetricasDePagos.NOMBRE_DEL_MEDIDOR));
    }

    @Bean
    ProcesarPago procesarPago(
            PedidosPort pedidos, PasarelaPort pasarela, RepositorioDePagos repositorio, ObservadorDePagos observador) {
        return new ProcesarPago(pedidos, pasarela, repositorio, observador);
    }

    @Bean
    ListarPagos listarPagos(RepositorioDePagos repositorio) {
        return new ListarPagos(repositorio);
    }

    @Bean
    ObtenerPago obtenerPago(RepositorioDePagos repositorio) {
        return new ObtenerPago(repositorio);
    }
}
