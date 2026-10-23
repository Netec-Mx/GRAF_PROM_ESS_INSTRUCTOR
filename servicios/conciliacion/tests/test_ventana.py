"""La ventana de conciliación: qué pedidos entran y por qué."""

from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest

from conciliacion.aplicacion import Conciliar, DependenciaNoDisponibleError
from conciliacion.configuracion import leer
from conciliacion.dominio import Pago, Pedido, Resultado, Ventana, instante, recortar
from conciliacion.infraestructura.clientes_http import ClientePagos, ClientePedidos
from tests.servidor import levantar
from tests.test_aplicacion import PagosFalso, PedidosFalso, PublicadorFalso

AHORA = datetime(2026, 10, 12, 12, 0, 0, tzinfo=UTC)
VENTANA_S = 900.0
GRACIA_S = 60.0


def hace(segundos: float) -> str:
    """La fecha de un pedido creado esa cantidad de segundos antes de AHORA."""
    return (AHORA - timedelta(seconds=segundos)).strftime("%Y-%m-%dT%H:%M:%SZ")


def pedido(numero: int, segundos: float) -> Pedido:
    return Pedido(f"PED-{numero:06d}", hace(segundos), Decimal("100.00"))


def pago(numero: int, segundos: float, estado: str = "aprobado") -> Pago:
    return Pago(f"PAG-{numero:06d}", f"PED-{numero:06d}", hace(segundos), Decimal("100.00"), estado)


class Reloj:
    """Reloj falso: la prueba decide qué hora es."""

    def __init__(self, ahora: datetime = AHORA) -> None:
        self.ahora = ahora

    def __call__(self) -> float:
        return self.ahora.timestamp()


def conciliar_con(
    pedidos: list[Pedido], pagos: list[Pago], reloj: Reloj | None = None
) -> Resultado:
    corrida = Conciliar(
        PedidosFalso(pedidos),
        PagosFalso(pagos),
        PublicadorFalso(),
        reloj=reloj or Reloj(),
        cronometro=lambda: 0.0,
        ventana=VENTANA_S,
        gracia=GRACIA_S,
    ).ejecutar()
    assert corrida.resultado is not None
    return corrida.resultado


# --- Los bordes ----------------------------------------------------------------------------


def test_la_ventana_va_de_ahora_menos_el_largo_a_ahora_menos_la_gracia() -> None:
    ventana = Ventana.hasta_ahora(AHORA.timestamp(), VENTANA_S, GRACIA_S)

    assert ventana.desde == datetime(2026, 10, 12, 11, 45, 0, tzinfo=UTC)
    assert ventana.hasta == datetime(2026, 10, 12, 11, 59, 0, tzinfo=UTC)


@pytest.mark.parametrize(
    ("segundos", "entra"),
    [
        (0, False),  # recién creado: el cliente todavía lo está pagando
        (59, False),
        (60, True),  # borde de la gracia: entra
        (61, True),
        (450, True),
        (899, True),
        (900, True),  # borde de la ventana: entra
        (901, False),  # ya salió de la ventana
        (86_400, False),
    ],
)
def test_un_pedido_entra_segun_hace_cuanto_se_creo(segundos: float, entra: bool) -> None:
    resultado = conciliar_con([pedido(1, segundos)], [])

    assert resultado.pedidos_revisados == (1 if entra else 0)
    assert resultado.pedidos_sin_pago == (1 if entra else 0)


def test_un_pedido_recien_creado_y_sin_pago_no_cuenta_como_sin_pago() -> None:
    """Es el caso que la gracia resuelve: el cliente tarda unos segundos en pagar."""
    resultado = conciliar_con([pedido(1, 5), pedido(2, 300)], [pago(2, 300)])

    assert resultado == Resultado(1, 0, 0, Decimal("100.00"))


def test_un_pedido_viejo_cuyo_pago_ya_no_esta_no_cuenta_como_sin_pago() -> None:
    """Es el caso que el largo de la ventana resuelve: pagos ya descartó ese pago."""
    resultado = conciliar_con([pedido(1, 3600), pedido(2, 300)], [pago(2, 300)])

    assert resultado == Resultado(1, 0, 0, Decimal("100.00"))


def test_dentro_de_la_ventana_un_pago_rechazado_si_deja_al_pedido_sin_pago() -> None:
    pedidos = [pedido(1, 300), pedido(2, 400), pedido(3, 500)]
    pagos = [pago(1, 300), pago(2, 400, "rechazado"), pago(3, 500, "error_pasarela")]

    resultado = conciliar_con(pedidos, pagos)

    assert resultado == Resultado(3, 2, 0, Decimal("100.00"))


def test_el_monto_aprobado_suma_solo_los_pagos_de_pedidos_de_la_ventana() -> None:
    pedidos = [pedido(1, 300)]
    pagos = [pago(1, 300), pago(2, 3600), pago(3, 10)]

    resultado = conciliar_con(pedidos, pagos)

    assert resultado.monto_aprobado == Decimal("100.00")


def test_la_ventana_avanza_con_el_reloj() -> None:
    reloj = Reloj()
    pedidos = [pedido(1, 30), pedido(2, 870)]

    assert conciliar_con(pedidos, [], reloj).pedidos_revisados == 1

    # Un minuto después entra el pedido nuevo y sale el viejo.
    reloj.ahora += timedelta(seconds=60)
    antes = conciliar_con([pedidos[1]], [], reloj).pedidos_revisados
    despues = conciliar_con([pedidos[0]], [], reloj).pedidos_revisados
    assert (antes, despues) == (0, 1)


def test_la_fecha_se_compara_como_instante_y_no_como_texto() -> None:
    """La misma hora escrita con otra zona horaria cae en el mismo lugar de la ventana."""
    ventana = Ventana.hasta_ahora(AHORA.timestamp(), VENTANA_S, GRACIA_S)

    assert ventana.contiene("2026-10-12T11:50:00Z")
    assert ventana.contiene("2026-10-12T08:50:00-03:00")
    assert not ventana.contiene("2026-10-12T11:50:00-03:00")


def test_recortar_elige_los_pagos_por_la_fecha_de_su_pedido() -> None:
    ventana = Ventana.hasta_ahora(AHORA.timestamp(), VENTANA_S, GRACIA_S)

    pedidos, pagos = recortar(
        [pedido(1, 300), pedido(2, 5)], [pago(1, 300), pago(2, 5), pago(3, 2000)], ventana
    )

    assert [p.id for p in pedidos] == ["PED-000001"]
    assert [p.id for p in pagos] == ["PAG-000001"]


# --- Fechas que no sirven ------------------------------------------------------------------


@pytest.mark.parametrize("fecha", ["ayer", "2026-10-12", "2026-10-12T11:50:00", "12/10/2026"])
def test_una_fecha_sin_hora_o_sin_zona_no_es_un_instante(fecha: str) -> None:
    with pytest.raises(ValueError, match=r"zona horaria|Invalid isoformat|month must be"):
        instante(fecha)


@pytest.mark.parametrize("fecha", ["ayer", "2026-10-12T11:50:00", ""])
def test_un_pedido_con_una_fecha_que_no_sirve_hace_fallar_la_corrida(fecha: str) -> None:
    with levantar() as servicio:
        servicio.responder(
            "/pedidos?estado=confirmado",
            {
                "total": 1,
                "pedidos": [{"id": "PED-000001", "creado_en": fecha, "total_mxn": "10.00"}],
            },
        )

        with pytest.raises(DependenciaNoDisponibleError, match="creado_en"):
            ClientePedidos(servicio.url, 5.0).confirmados()


def test_un_pago_con_una_fecha_que_no_sirve_hace_fallar_la_corrida() -> None:
    with levantar() as servicio:
        un_pago = {
            "id": "PAG-000001",
            "pedido_id": "PED-000001",
            "pedido_creado_en": "2026-10-12 11:50",
            "monto_mxn": "10.00",
            "estado": "aprobado",
        }
        servicio.responder("/pagos", {"total": 1, "pagos": [un_pago]})

        with pytest.raises(DependenciaNoDisponibleError, match="pedido_creado_en"):
            ClientePagos(servicio.url, 5.0).todos()


# --- Configuración -------------------------------------------------------------------------


def test_por_defecto_la_ventana_es_de_15_minutos_con_un_minuto_de_gracia() -> None:
    config = leer({})

    assert (config.ventana, config.gracia) == (900.0, 60.0)


def test_la_ventana_y_la_gracia_salen_del_entorno() -> None:
    config = leer({"CONCILIACION_VENTANA_S": "600", "CONCILIACION_GRACIA_S": "0"})

    assert (config.ventana, config.gracia) == (600.0, 0.0)


@pytest.mark.parametrize(
    "entorno",
    [
        {"CONCILIACION_VENTANA_S": "0"},
        {"CONCILIACION_VENTANA_S": "-5"},
        {"CONCILIACION_VENTANA_S": "mucho"},
        {"CONCILIACION_GRACIA_S": "-1"},
        {"CONCILIACION_GRACIA_S": "900"},
        {"CONCILIACION_VENTANA_S": "60", "CONCILIACION_GRACIA_S": "120"},
    ],
)
def test_una_ventana_que_no_tiene_sentido_no_se_acepta(entorno: dict[str, str]) -> None:
    with pytest.raises(ValueError, match="CONCILIACION_"):
        leer(entorno)
