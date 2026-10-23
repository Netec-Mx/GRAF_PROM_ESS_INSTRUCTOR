import pytest

from catalogo.aplicacion import BuscarProductos, ListarProductos, ObtenerProducto
from catalogo.dominio import ProductoNoEncontradoError
from catalogo.infraestructura import RepositorioEnMemoria


def test_listar_devuelve_todos(repositorio: RepositorioEnMemoria) -> None:
    assert len(ListarProductos(repositorio).ejecutar()) == 5


def test_listar_filtra_por_categoria(repositorio: RepositorioEnMemoria) -> None:
    frutas = ListarProductos(repositorio).ejecutar("frutas-y-verduras")
    assert [p.sku for p in frutas] == ["TNG-0001", "TNG-0003", "TNG-0005"]


def test_listar_categoria_inexistente_devuelve_vacio(repositorio: RepositorioEnMemoria) -> None:
    assert list(ListarProductos(repositorio).ejecutar("juguetes")) == []


def test_obtener_por_sku(repositorio: RepositorioEnMemoria) -> None:
    assert ObtenerProducto(repositorio).ejecutar("TNG-0007").nombre == "Tamal oaxaqueño de mole"


def test_obtener_sku_inexistente_lanza_error_de_dominio(repositorio: RepositorioEnMemoria) -> None:
    with pytest.raises(ProductoNoEncontradoError) as error:
        ObtenerProducto(repositorio).ejecutar("TNG-9999")
    assert error.value.sku == "TNG-9999"


@pytest.mark.parametrize("consulta", ["limón", "limon", "LIMON", "  Limón "])
def test_buscar_ignora_mayusculas_y_acentos(
    repositorio: RepositorioEnMemoria, consulta: str
) -> None:
    assert [p.sku for p in BuscarProductos(repositorio).ejecutar(consulta)] == ["TNG-0003"]


def test_buscar_sin_coincidencias_devuelve_vacio(repositorio: RepositorioEnMemoria) -> None:
    assert list(BuscarProductos(repositorio).ejecutar("piñata")) == []
