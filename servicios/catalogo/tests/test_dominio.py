from collections.abc import Callable
from dataclasses import FrozenInstanceError
from decimal import Decimal

import pytest

from catalogo.dominio import Producto, ProductoInvalidoError


def _producto(
    sku: str = "TNG-0001",
    nombre: str = "Aguacate Hass (kg)",
    categoria: str = "frutas-y-verduras",
    precio_mxn: Decimal = Decimal("89.00"),
    stock: int = 40,
) -> Producto:
    return Producto(sku=sku, nombre=nombre, categoria=categoria, precio_mxn=precio_mxn, stock=stock)


def test_producto_es_inmutable() -> None:
    producto = _producto()
    campo = "stock"
    with pytest.raises(FrozenInstanceError):
        setattr(producto, campo, 1)


def test_precio_se_normaliza_a_dos_decimales() -> None:
    assert str(_producto(precio_mxn=Decimal("89")).precio_mxn) == "89.00"


def test_agotado_cuando_el_stock_es_cero() -> None:
    assert _producto(stock=0).agotado
    assert not _producto(stock=1).agotado


@pytest.mark.parametrize(
    "construir",
    [
        lambda: _producto(sku="TNG-1"),
        lambda: _producto(sku="ABC-0001"),
        lambda: _producto(nombre="  "),
        lambda: _producto(categoria=""),
        lambda: _producto(precio_mxn=Decimal("-1.00")),
        lambda: _producto(precio_mxn=Decimal("1.005")),
        lambda: _producto(precio_mxn=Decimal("NaN")),
        lambda: _producto(stock=-1),
    ],
)
def test_datos_invalidos_se_rechazan(construir: Callable[[], Producto]) -> None:
    with pytest.raises(ProductoInvalidoError):
        construir()
