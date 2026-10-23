"""Casos de uso: listar, obtener por sku y buscar."""

import unicodedata
from collections.abc import Sequence
from dataclasses import dataclass

from catalogo.aplicacion.puertos import RepositorioDeProductos
from catalogo.dominio import Producto, ProductoNoEncontradoError


def _normalizar(texto: str) -> str:
    """Minúsculas y sin acentos, para que 'limon' encuentre 'Limón'."""
    descompuesto = unicodedata.normalize("NFD", texto.casefold())
    return "".join(c for c in descompuesto if unicodedata.category(c) != "Mn").strip()


@dataclass(frozen=True, slots=True)
class ListarProductos:
    repositorio: RepositorioDeProductos

    def ejecutar(self, categoria: str | None = None) -> Sequence[Producto]:
        productos = self.repositorio.todos()
        if categoria is None:
            return productos
        return [p for p in productos if p.categoria == categoria]


@dataclass(frozen=True, slots=True)
class ObtenerProducto:
    repositorio: RepositorioDeProductos

    def ejecutar(self, sku: str) -> Producto:
        producto = self.repositorio.por_sku(sku)
        if producto is None:
            raise ProductoNoEncontradoError(sku)
        return producto


@dataclass(frozen=True, slots=True)
class BuscarProductos:
    repositorio: RepositorioDeProductos

    def ejecutar(self, consulta: str) -> Sequence[Producto]:
        termino = _normalizar(consulta)
        if not termino:
            return []
        return [p for p in self.repositorio.todos() if termino in _normalizar(p.nombre)]
