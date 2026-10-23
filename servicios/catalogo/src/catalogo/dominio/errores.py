"""Errores de dominio."""


class DominioError(Exception):
    """Base de los errores del catálogo."""


class ProductoInvalidoError(DominioError):
    """Los datos de un producto no cumplen las reglas del dominio."""


class ProductoNoEncontradoError(DominioError):
    """No existe un producto con el sku pedido."""

    def __init__(self, sku: str) -> None:
        super().__init__(f"No existe un producto con sku {sku}")
        self.sku = sku
