package mx.tianguis.pagos.api;

import java.net.URI;
import java.util.List;
import mx.tianguis.pagos.aplicacion.ListarPagos;
import mx.tianguis.pagos.aplicacion.ObtenerPago;
import mx.tianguis.pagos.aplicacion.PagoProcesado;
import mx.tianguis.pagos.aplicacion.ProcesarPago;
import mx.tianguis.pagos.dominio.Montos;
import mx.tianguis.pagos.dominio.Pago;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Rutas de pagos. */
@RestController
public class PagosControlador {

    private static final Logger LOG = LoggerFactory.getLogger(PagosControlador.class);

    private final ProcesarPago procesarPago;
    private final ObtenerPago obtenerPago;
    private final ListarPagos listarPagos;

    PagosControlador(ProcesarPago procesarPago, ObtenerPago obtenerPago, ListarPagos listarPagos) {
        this.procesarPago = procesarPago;
        this.obtenerPago = obtenerPago;
        this.listarPagos = listarPagos;
    }

    @GetMapping("/pagos")
    ListaDePagosRespuesta listar(@RequestParam(name = "estado", required = false) String estado) {
        List<PagoRespuesta> pagos = listarPagos.listar(estado).stream().map(PagoRespuesta::de).toList();
        return new ListaDePagosRespuesta(pagos.size(), pagos);
    }

    @PostMapping("/pagos")
    ResponseEntity<PagoRespuesta> crear(@RequestBody SolicitudDePago solicitud) {
        PagoProcesado procesado = procesarPago.procesar(solicitud.pedidoId(), solicitud.metodo());
        Pago pago = procesado.pago();

        LOG.atInfo()
                .addKeyValue("payment_id", pago.id())
                .addKeyValue("order_id", pago.pedidoId())
                .addKeyValue("method", pago.metodo().codigo())
                .addKeyValue("result", procesado.resultado().codigo())
                .addKeyValue("amount_mxn", Montos.aTexto(pago.monto()))
                .log("pago procesado");

        HttpStatus estado = switch (pago.estado()) {
            case APROBADO -> HttpStatus.CREATED;
            case RECHAZADO -> HttpStatus.PAYMENT_REQUIRED;
            case ERROR_PASARELA -> HttpStatus.BAD_GATEWAY;
        };
        return ResponseEntity.status(estado)
                .location(URI.create("/pagos/" + pago.id()))
                .body(PagoRespuesta.de(pago));
    }

    @GetMapping("/pagos/{id}")
    PagoRespuesta obtener(@PathVariable("id") String id) {
        return PagoRespuesta.de(obtenerPago.obtener(id));
    }
}
