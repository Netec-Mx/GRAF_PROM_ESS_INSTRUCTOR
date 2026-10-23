from fastapi.testclient import TestClient


def test_listar_productos(cliente: TestClient) -> None:
    respuesta = cliente.get("/productos")
    assert respuesta.status_code == 200
    cuerpo = respuesta.json()
    assert cuerpo["total"] == 5
    assert cuerpo["productos"][0] == {
        "sku": "TNG-0001",
        "nombre": "Aguacate Hass (kg)",
        "categoria": "frutas-y-verduras",
        "precio_mxn": "89.00",
        "stock": 40,
    }


def test_listar_filtra_por_categoria(cliente: TestClient) -> None:
    cuerpo = cliente.get("/productos", params={"categoria": "antojitos"}).json()
    assert [p["sku"] for p in cuerpo["productos"]] == ["TNG-0007"]


def test_precios_siempre_con_dos_decimales(cliente: TestClient) -> None:
    precios = [p["precio_mxn"] for p in cliente.get("/productos").json()["productos"]]
    assert precios == ["89.00", "28.00", "54.00", "28.00", "620.00"]


def test_detalle_de_producto(cliente: TestClient) -> None:
    respuesta = cliente.get("/productos/TNG-0013")
    assert respuesta.status_code == 200
    assert respuesta.json()["stock"] == 0


def test_detalle_inexistente_da_404(cliente: TestClient) -> None:
    respuesta = cliente.get("/productos/TNG-9999")
    assert respuesta.status_code == 404
    assert respuesta.json()["error"] == "producto_no_encontrado"


def test_buscar_no_se_confunde_con_un_sku(cliente: TestClient) -> None:
    respuesta = cliente.get("/productos/buscar", params={"q": "tamal"})
    assert respuesta.status_code == 200
    assert [p["sku"] for p in respuesta.json()["productos"]] == ["TNG-0007"]


def test_buscar_sin_q_da_422(cliente: TestClient) -> None:
    assert cliente.get("/productos/buscar").status_code == 422


def test_salud(cliente: TestClient) -> None:
    respuesta = cliente.get("/salud")
    assert respuesta.status_code == 200
    assert respuesta.json() == {"estado": "ok"}
