import json
from collections import Counter
from pathlib import Path

import pytest

from catalogo.dominio import ProductoInvalidoError
from catalogo.infraestructura import RepositorioEnMemoria
from catalogo.main import ruta_de_datos


def test_datos_semilla_cumplen_el_spec() -> None:
    productos = RepositorioEnMemoria.desde_json(ruta_de_datos()).todos()
    assert len(productos) == 20
    assert Counter(p.categoria for p in productos) == {
        "frutas-y-verduras": 5,
        "antojitos": 5,
        "artesanias": 5,
        "abarrotes": 5,
    }
    assert sum(p.agotado for p in productos) >= 3
    assert [p.sku for p in productos] == [f"TNG-{n:04d}" for n in range(1, 21)]


def test_por_sku(repositorio: RepositorioEnMemoria) -> None:
    encontrado = repositorio.por_sku("TNG-0001")
    assert encontrado is not None
    assert encontrado.nombre == "Aguacate Hass (kg)"
    assert repositorio.por_sku("TNG-9999") is None


@pytest.mark.parametrize(
    "contenido",
    [
        {"sku": "TNG-0001"},
        [{"sku": "TNG-0001", "nombre": "x", "categoria": "c", "stock": 1}],
        [{"sku": "TNG-0001", "nombre": "x", "categoria": "c", "precio_mxn": "caro", "stock": 1}],
        ["no soy un producto"],
        [
            {"sku": "TNG-0001", "nombre": "x", "categoria": "c", "precio_mxn": "1.00", "stock": 1},
            {"sku": "TNG-0001", "nombre": "y", "categoria": "c", "precio_mxn": "2.00", "stock": 1},
        ],
    ],
)
def test_json_invalido_se_rechaza(tmp_path: Path, contenido: object) -> None:
    archivo = tmp_path / "productos.json"
    archivo.write_text(json.dumps(contenido), encoding="utf-8")
    with pytest.raises(ProductoInvalidoError):
        RepositorioEnMemoria.desde_json(archivo)
