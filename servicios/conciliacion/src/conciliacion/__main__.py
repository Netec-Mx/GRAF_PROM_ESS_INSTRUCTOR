"""Una corrida de conciliación: python -m conciliacion.

Trae pedidos y pagos, los cruza, empuja el resultado al Pushgateway y termina.
Código de salida 0 si la corrida fue exitosa y 1 si falló.
"""

import logging
import os
import sys
import time
import uuid
from dataclasses import dataclass

from conciliacion.aplicacion import Conciliar, Corrida, PublicacionFallidaError, PublicadorPort
from conciliacion.configuracion import Configuracion, leer
from conciliacion.infraestructura.caos import BanderaDeCaos, PedidosConCaos
from conciliacion.infraestructura.clientes_http import ClientePagos, ClientePedidos
from conciliacion.infraestructura.publicador_pushgateway import PublicadorPushgateway
from conciliacion.registro import configurar_logs

logger = logging.getLogger("conciliacion")

# Quién pidió la corrida. El planificador la pasa por esta variable de entorno.
VARIABLE_DE_ORIGEN = "CONCILIACION_ORIGEN"
ORIGEN_PLANIFICADO = "scheduled"
ORIGEN_MANUAL = "manual"
ORIGEN_DIRECTO = "direct"


@dataclass(frozen=True, slots=True)
class Piezas:
    """El caso de uso y su publicador, que la red de seguridad necesita aparte."""

    conciliar: Conciliar
    publicador: PublicadorPort


def armar(config: Configuracion) -> Piezas:
    bandera = BanderaDeCaos(config.bandera_de_caos, habilitada=config.caos_habilitado)
    publicador = PublicadorPushgateway(
        config.pushgateway_url, config.timeout, caos_activo=bandera.activa
    )
    conciliar = Conciliar(
        # El caos entra por un decorador del puerto: el caso de uso no sabe que existe.
        pedidos=PedidosConCaos(ClientePedidos(config.pedidos_url, config.timeout), bandera),
        pagos=ClientePagos(config.pagos_url, config.timeout),
        publicador=publicador,
        reloj=time.time,
        cronometro=time.monotonic,
        ventana=config.ventana,
        gracia=config.gracia,
    )
    return Piezas(conciliar, publicador)


def correr_con_red(piezas: Piezas) -> Corrida:
    """Ejecuta la corrida. Si algo inesperado se rompe, igual la publica como fallida.

    El caso de uso ya publica las fallas que conoce: una dependencia caída o un Pushgateway
    que no responde. Esta red cubre lo demás, como un error de programación. Sin ella el
    proceso moriría con una traza de Python y sin empujar nada, y
    conciliacion_last_run_success se quedaría en 1 con el job roto.
    """
    inicio = time.monotonic()
    try:
        return piezas.conciliar.ejecutar()
    except Exception as error:
        duracion = time.monotonic() - inicio
        motivo = f"error inesperado: {type(error).__name__}: {error}"
        logger.exception("error inesperado en la corrida")
        try:
            piezas.publicador.publicar_falla(time.time(), duracion)
        except PublicacionFallidaError as error_al_publicar:
            motivo = f"{motivo}; además no se pudo publicar la falla: {error_al_publicar}"
        return Corrida(exitosa=False, duracion=duracion, error=motivo)


def registrar_fin(corrida: Corrida, run_id: str, origen: str = ORIGEN_DIRECTO) -> None:
    """Escribe la línea de fin de una corrida."""
    campos: dict[str, object] = {
        "run_id": run_id,
        "trigger": origen,
        "result": "success" if corrida.exitosa else "failure",
        "duration_ms": round(corrida.duracion * 1000, 3),
    }
    if corrida.resultado is not None:
        campos["orders_checked"] = corrida.resultado.pedidos_revisados
        campos["orders_unpaid"] = corrida.resultado.pedidos_sin_pago
        campos["amount_mismatches"] = corrida.resultado.montos_distintos
        campos["approved_amount_mxn"] = str(corrida.resultado.monto_aprobado)
    if corrida.error is not None:
        campos["error"] = corrida.error
    if corrida.exitosa:
        logger.info("conciliacion terminada", extra=campos)
    else:
        logger.error("conciliacion fallida", extra=campos)


def ejecutar() -> int:
    configurar_logs()
    run_id = uuid.uuid4().hex[:12]
    origen = os.environ.get(VARIABLE_DE_ORIGEN, ORIGEN_DIRECTO)
    try:
        piezas = armar(leer())
    except ValueError as error:
        logger.error(
            "configuracion invalida",
            extra={"run_id": run_id, "trigger": origen, "error": str(error)},
        )
        return 1

    logger.info("conciliacion iniciada", extra={"run_id": run_id, "trigger": origen})
    corrida = correr_con_red(piezas)
    registrar_fin(corrida, run_id, origen)
    return 0 if corrida.exitosa else 1


if __name__ == "__main__":
    sys.exit(ejecutar())
