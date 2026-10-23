"""Entidad Producto."""

import re
from dataclasses import dataclass
from decimal import Decimal

from catalogo.dominio.errores import ProductoInvalidoError

_FORMATO_SKU = re.compile(r"TNG-\d{4}")
_DOS_DECIMALES = Decimal("0.01")


@dataclass(frozen=True, slots=True)
class Producto:
    """Un producto del tianguis. El precio va en pesos mexicanos con dos decimales."""

    sku: str
    nombre: str
    categoria: str
    precio_mxn: Decimal
    stock: int

    def __post_init__(self) -> None:
        if not _FORMATO_SKU.fullmatch(self.sku):
            raise ProductoInvalidoError(f"sku con formato inválido: {self.sku!r}")
        if not self.nombre.strip():
            raise ProductoInvalidoError(f"{self.sku}: el nombre no puede estar vacío")
        if not self.categoria.strip():
            raise ProductoInvalidoError(f"{self.sku}: la categoría no puede estar vacía")
        if not self.precio_mxn.is_finite() or self.precio_mxn < 0:
            raise ProductoInvalidoError(f"{self.sku}: precio inválido {self.precio_mxn}")
        if self.precio_mxn != self.precio_mxn.quantize(_DOS_DECIMALES):
            raise ProductoInvalidoError(f"{self.sku}: el precio lleva más de dos decimales")
        if self.stock < 0:
            raise ProductoInvalidoError(f"{self.sku}: el stock no puede ser negativo")
        # Normaliza la escala para que 89 y 89.00 sean el mismo precio al mostrarlo.
        object.__setattr__(self, "precio_mxn", self.precio_mxn.quantize(_DOS_DECIMALES))

    @property
    def agotado(self) -> bool:
        return self.stock == 0
