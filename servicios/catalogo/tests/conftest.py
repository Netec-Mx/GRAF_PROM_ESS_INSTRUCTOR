"""Fixtures compartidas."""

from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from catalogo.dominio import Producto
from catalogo.infraestructura import RepositorioEnMemoria
from catalogo.main import crear_app


@pytest.fixture
def productos() -> list[Producto]:
    return [
        Producto("TNG-0001", "Aguacate Hass (kg)", "frutas-y-verduras", Decimal("89.00"), 40),
        Producto("TNG-0003", "Limón con semilla (kg)", "frutas-y-verduras", Decimal("28"), 85),
        Producto("TNG-0005", "Mango ataulfo (kg)", "frutas-y-verduras", Decimal("54.00"), 0),
        Producto("TNG-0007", "Tamal oaxaqueño de mole", "antojitos", Decimal("28.00"), 60),
        Producto("TNG-0013", "Rebozo de algodón", "artesanias", Decimal("620.00"), 0),
    ]


@pytest.fixture
def repositorio(productos: list[Producto]) -> RepositorioEnMemoria:
    return RepositorioEnMemoria(productos)


@pytest.fixture
def cliente(repositorio: RepositorioEnMemoria) -> TestClient:
    return TestClient(crear_app(repositorio))
