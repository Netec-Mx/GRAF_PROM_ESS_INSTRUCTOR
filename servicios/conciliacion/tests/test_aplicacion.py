from dataclasses import dataclass, field
from datetime import UTC, datetime
from decimal import Decimal

from conciliacion.aplicacion import (
    Conciliar,
    DependenciaNoDisponibleError,
    PublicacionFallidaError,
)
from conciliacion.dominio import Pago, Pedido, Resultado


@dataclass
class PedidosFalso:
    pedidos: list[Pedido] = field(default_factory=list)
    caido: bool = False

    def confirmados(self) -> list[Pedido]:
        if self.caido:
            raise DependenciaNoDisponibleError("pedidos no respondió")
        return self.pedidos


@dataclass
class PagosFalso:
    pagos: list[Pago] = field(default_factory=list)
    caido: bool = False

    def todos(self) -> list[Pago]:
        if self.caido:
            raise DependenciaNoDisponibleError("pagos no respondió")
        return self.pagos


@dataclass
class PublicadorFalso:
    caido: bool = False
    exitos: list[tuple[Resultado, float, float]] = field(default_factory=list)
    fallas: list[tuple[float, float]] = field(default_factory=list)

    def publicar_exito(self, resultado: Resultado, instante: float, duracion: float) -> None:
        if self.caido:
            raise PublicacionFallidaError("el Pushgateway no respondió")
        self.exitos.append((resultado, instante, duracion))

    def publicar_falla(self, instante: float, duracion: float) -> None:
        if self.caido:
            raise PublicacionFallidaError("el Pushgateway no respondió")
        self.fallas.append((instante, duracion))


class Cronometro:
    """Reloj de mentira: cada lectura avanza 1.5 segundos."""

    def __init__(self) -> None:
        self._ahora = 100.0

    def __call__(self) -> float:
        self._ahora += 1.5
        return self._ahora


def armar(pedidos: PedidosFalso, pagos: PagosFalso, publicador: PublicadorFalso) -> Conciliar:
    return Conciliar(
        pedidos,
        pagos,
        publicador,
        reloj=lambda: AHORA,
        cronometro=Cronometro(),
        ventana=900.0,
        gracia=60.0,
    )


# Los pedidos de estas pruebas se crearon 5 minutos antes de la corrida: dentro de la ventana.
CREADO = "2026-10-12T03:00:00Z"
AHORA = datetime(2026, 10, 12, 3, 5, 0, tzinfo=UTC).timestamp()
PEDIDOS = [
    Pedido("PED-000001", CREADO, Decimal("275.50")),
    Pedido("PED-000002", CREADO, Decimal("89.00")),
]
PAGOS = [Pago("PAG-000001", "PED-000001", CREADO, Decimal("275.50"), "aprobado")]


def test_corrida_exitosa_publica_el_resultado() -> None:
    publicador = PublicadorFalso()

    corrida = armar(PedidosFalso(PEDIDOS), PagosFalso(PAGOS), publicador).ejecutar()

    esperado = Resultado(2, 1, 0, Decimal("275.50"))
    assert corrida.exitosa
    assert corrida.resultado == esperado
    assert corrida.duracion == 1.5
    assert publicador.exitos == [(esperado, AHORA, 1.5)]
    assert publicador.fallas == []


def test_si_pedidos_no_responde_la_corrida_falla_y_publica_la_falla() -> None:
    publicador = PublicadorFalso()

    corrida = armar(PedidosFalso(caido=True), PagosFalso(PAGOS), publicador).ejecutar()

    assert not corrida.exitosa
    assert corrida.resultado is None
    assert corrida.error == "pedidos no respondió"
    assert publicador.exitos == []
    assert publicador.fallas == [(AHORA, 1.5)]


def test_si_pagos_no_responde_la_corrida_falla_y_publica_la_falla() -> None:
    publicador = PublicadorFalso()

    corrida = armar(PedidosFalso(PEDIDOS), PagosFalso(caido=True), publicador).ejecutar()

    assert not corrida.exitosa
    assert corrida.error == "pagos no respondió"
    assert publicador.exitos == []
    assert len(publicador.fallas) == 1


def test_si_no_se_puede_publicar_el_exito_la_corrida_falla() -> None:
    corrida = armar(
        PedidosFalso(PEDIDOS), PagosFalso(PAGOS), PublicadorFalso(caido=True)
    ).ejecutar()

    assert not corrida.exitosa
    assert corrida.error == "el Pushgateway no respondió"


def test_si_falla_la_dependencia_y_tambien_la_publicacion_se_informan_las_dos() -> None:
    corrida = armar(PedidosFalso(caido=True), PagosFalso(), PublicadorFalso(caido=True)).ejecutar()

    assert not corrida.exitosa
    assert corrida.error is not None
    assert "pedidos no respondió" in corrida.error
    assert "no se pudo publicar la falla" in corrida.error
