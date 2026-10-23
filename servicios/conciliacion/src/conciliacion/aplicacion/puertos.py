"""Puertos del caso de uso: de dónde salen los datos y a dónde van los resultados."""

from typing import Protocol

from conciliacion.dominio import Pago, Pedido, Resultado


class DependenciaNoDisponibleError(Exception):
    """pedidos o pagos no respondió, o respondió algo que no se puede usar."""


class PublicacionFallidaError(Exception):
    """No se pudieron empujar las métricas."""


class PedidosPort(Protocol):
    def confirmados(self) -> list[Pedido]:
        """Devuelve los pedidos confirmados. Lanza DependenciaNoDisponibleError si no puede."""
        ...


class PagosPort(Protocol):
    def todos(self) -> list[Pago]:
        """Devuelve todos los pagos. Lanza DependenciaNoDisponibleError si no puede."""
        ...


class PublicadorPort(Protocol):
    def publicar_exito(self, resultado: Resultado, instante: float, duracion: float) -> None:
        """Publica una corrida exitosa. Lanza PublicacionFallidaError si no puede."""
        ...

    def publicar_falla(self, instante: float, duracion: float) -> None:
        """Publica una corrida fallida, sin tocar los datos de la última exitosa."""
        ...
