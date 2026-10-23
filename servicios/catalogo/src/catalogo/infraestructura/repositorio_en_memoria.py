"""Repositorio en memoria, cargado una vez desde un archivo JSON."""

import json
from collections.abc import Iterable, Sequence
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Self

from catalogo.dominio import Producto, ProductoInvalidoError


class RepositorioEnMemoria:
    """Implementa RepositorioDeProductos sobre una lista fija."""

    def __init__(self, productos: Iterable[Producto]) -> None:
        self._productos: tuple[Producto, ...] = tuple(productos)
        self._por_sku: dict[str, Producto] = {p.sku: p for p in self._productos}
        if len(self._por_sku) != len(self._productos):
            raise ProductoInvalidoError("hay skus repetidos en los datos")

    @classmethod
    def desde_json(cls, ruta: Path) -> Self:
        crudo: object = json.loads(ruta.read_text(encoding="utf-8"))
        if not isinstance(crudo, list):
            raise ProductoInvalidoError(f"{ruta}: se esperaba una lista de productos")
        return cls(_a_producto(fila) for fila in crudo)

    def todos(self) -> Sequence[Producto]:
        return self._productos

    def por_sku(self, sku: str) -> Producto | None:
        return self._por_sku.get(sku)


def _a_producto(fila: object) -> Producto:
    if not isinstance(fila, dict):
        raise ProductoInvalidoError(f"fila inválida en los datos: {fila!r}")
    try:
        return Producto(
            sku=str(fila["sku"]),
            nombre=str(fila["nombre"]),
            categoria=str(fila["categoria"]),
            precio_mxn=Decimal(str(fila["precio_mxn"])),
            stock=int(fila["stock"]),
        )
    except (KeyError, ValueError, InvalidOperation) as error:
        raise ProductoInvalidoError(f"fila inválida en los datos: {fila!r}") from error
