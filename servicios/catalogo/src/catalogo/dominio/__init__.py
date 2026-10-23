"""Dominio del catálogo. No conoce FastAPI ni prometheus_client."""

from catalogo.dominio.errores import DominioError, ProductoInvalidoError, ProductoNoEncontradoError
from catalogo.dominio.producto import Producto

__all__ = ["DominioError", "Producto", "ProductoInvalidoError", "ProductoNoEncontradoError"]
