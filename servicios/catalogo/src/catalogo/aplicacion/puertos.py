"""Puertos que la aplicación necesita y la infraestructura implementa."""

from collections.abc import Sequence
from typing import Protocol

from catalogo.dominio import Producto


class RepositorioDeProductos(Protocol):
    """Acceso de solo lectura a los productos."""

    def todos(self) -> Sequence[Producto]: ...

    def por_sku(self, sku: str) -> Producto | None: ...
