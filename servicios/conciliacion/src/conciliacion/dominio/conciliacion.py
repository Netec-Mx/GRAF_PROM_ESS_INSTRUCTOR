"""Qué significa que los pedidos y los pagos cuadren."""

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal

ESTADO_APROBADO = "aprobado"


def instante(fecha: str) -> datetime:
    """Convierte una fecha como 2026-10-12T03:00:00Z en un instante.

    Lanza ValueError si no es una fecha o si no dice su zona horaria: sin zona no se puede
    saber si un pedido cae dentro de la ventana.
    """
    momento = datetime.fromisoformat(fecha)
    if momento.tzinfo is None:
        raise ValueError(f"la fecha {fecha!r} no trae zona horaria")
    return momento


@dataclass(frozen=True, slots=True)
class Ventana:
    """El tramo de tiempo que se concilia. Los dos bordes entran."""

    desde: datetime
    hasta: datetime

    @classmethod
    def hasta_ahora(cls, ahora: float, largo: float, gracia: float) -> Ventana:
        """La ventana que va de ahora menos largo a ahora menos gracia, en segundos.

        ahora es la hora actual como unix time.
        """
        momento = datetime.fromtimestamp(ahora, tz=UTC)
        return cls(momento - timedelta(seconds=largo), momento - timedelta(seconds=gracia))

    def contiene(self, fecha: str) -> bool:
        return self.desde <= instante(fecha) <= self.hasta


@dataclass(frozen=True, slots=True)
class Pedido:
    """Un pedido confirmado, con su total en pesos.

    Un pedido se identifica por su id y su fecha de creación. El id solo no alcanza: pedidos
    guarda en memoria y al reiniciarse vuelve a numerar desde PED-000001.
    """

    id: str
    creado_en: str
    total: Decimal

    @property
    def clave(self) -> tuple[str, str]:
        return (self.id, self.creado_en)


@dataclass(frozen=True, slots=True)
class Pago:
    """Un pago, aprobado o no, con su monto en pesos."""

    id: str
    pedido_id: str
    pedido_creado_en: str
    monto: Decimal
    estado: str

    @property
    def aprobado(self) -> bool:
        return self.estado == ESTADO_APROBADO

    @property
    def clave_del_pedido(self) -> tuple[str, str]:
        return (self.pedido_id, self.pedido_creado_en)


@dataclass(frozen=True, slots=True)
class Resultado:
    """Lo que encontró una conciliación."""

    pedidos_revisados: int
    pedidos_sin_pago: int
    montos_distintos: int
    monto_aprobado: Decimal


def recortar(
    pedidos: Iterable[Pedido], pagos: Iterable[Pago], ventana: Ventana
) -> tuple[list[Pedido], list[Pago]]:
    """Deja solo los pedidos creados dentro de la ventana, y los pagos de esos pedidos.

    Los pagos se eligen por la fecha de creación de su pedido, no por la hora del pago. Así
    los cuatro números de una conciliación hablan de los mismos pedidos.
    """
    return (
        [pedido for pedido in pedidos if ventana.contiene(pedido.creado_en)],
        [pago for pago in pagos if ventana.contiene(pago.pedido_creado_en)],
    )


def conciliar(pedidos: Iterable[Pedido], pagos: Iterable[Pago]) -> Resultado:
    """Cruza los pedidos confirmados con los pagos.

    - Un pago es de un pedido si coinciden el id y la fecha de creación. Un pago viejo no
      paga a un pedido nuevo que reusa su id.
    - Un pedido está pagado si tiene al menos un pago aprobado.
    - Un pago aprobado no cuadra si su monto difiere del total de su pedido. Si su pedido no
      está entre los confirmados no hay con qué compararlo, y no se cuenta.
    - El monto aprobado suma todos los pagos aprobados, con aritmética decimal exacta.
    """
    confirmados = {pedido.clave: pedido for pedido in pedidos}
    aprobados = [pago for pago in pagos if pago.aprobado]

    pedidos_pagados = {pago.clave_del_pedido for pago in aprobados}
    sin_pago = sum(1 for clave in confirmados if clave not in pedidos_pagados)

    distintos = sum(
        1
        for pago in aprobados
        if pago.clave_del_pedido in confirmados
        and pago.monto != confirmados[pago.clave_del_pedido].total
    )

    return Resultado(
        pedidos_revisados=len(confirmados),
        pedidos_sin_pago=sin_pago,
        montos_distintos=distintos,
        monto_aprobado=sum((pago.monto for pago in aprobados), start=Decimal("0.00")),
    )
