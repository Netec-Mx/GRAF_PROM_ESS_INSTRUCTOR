"""Las métricas HTTP usan la plantilla de la ruta, nunca la ruta real."""

from fastapi.testclient import TestClient
from prometheus_client import REGISTRY

Etiquetas = dict[str, str]


def _valor(nombre: str, etiquetas: Etiquetas | None = None) -> float:
    return REGISTRY.get_sample_value(nombre, etiquetas or {}) or 0.0


def _peticiones(ruta: str, estado: str) -> float:
    return _valor("http_server_requests_total", {"method": "GET", "route": ruta, "status": estado})


def _valores_de_route() -> set[str]:
    return {
        muestra.labels["route"]
        for familia in REGISTRY.collect()
        for muestra in familia.samples
        if "route" in muestra.labels
    }


def test_detalle_cuenta_con_la_plantilla_y_no_con_el_sku(cliente: TestClient) -> None:
    antes = _peticiones("/productos/{sku}", "200")

    cliente.get("/productos/TNG-0001")
    cliente.get("/productos/TNG-0007")

    assert _peticiones("/productos/{sku}", "200") == antes + 2
    assert _peticiones("/productos/TNG-0001", "200") == 0
    assert _peticiones("/productos/TNG-0007", "200") == 0


def test_un_404_de_sku_tambien_usa_la_plantilla(cliente: TestClient) -> None:
    antes = _peticiones("/productos/{sku}", "404")

    cliente.get("/productos/TNG-9999")

    assert _peticiones("/productos/{sku}", "404") == antes + 1
    assert _peticiones("/productos/TNG-9999", "404") == 0


def test_ningun_valor_de_route_contiene_un_sku_real(cliente: TestClient) -> None:
    for sku in ("TNG-0001", "TNG-0003", "TNG-0005", "TNG-9999", "no-existe"):
        cliente.get(f"/productos/{sku}")
    cliente.get("/productos")
    cliente.get("/productos/buscar", params={"q": "tamal"})
    cliente.get("/ruta/inventada/123")

    rutas = _valores_de_route()
    assert rutas <= {"/productos", "/productos/buscar", "/productos/{sku}", "unmatched"}
    assert not any("TNG-" in ruta for ruta in rutas)


def test_ruta_inexistente_se_agrupa_en_un_solo_valor(cliente: TestClient) -> None:
    antes = _peticiones("unmatched", "404")

    cliente.get("/ruta/inventada/1")
    cliente.get("/ruta/inventada/2")

    assert _peticiones("unmatched", "404") == antes + 2


def _valores_de(etiqueta: str) -> set[str]:
    return {
        muestra.labels[etiqueta]
        for familia in REGISTRY.collect()
        for muestra in familia.samples
        if etiqueta in muestra.labels
    }


def test_un_metodo_inventado_no_crea_una_serie_propia(cliente: TestClient) -> None:
    etiquetas = {"method": "OTHER", "route": "/productos", "status": "405"}
    antes = _valor("http_server_requests_total", etiquetas)

    for metodo in ("FOO1", "FOO2", "BARXYZ"):
        assert cliente.request(metodo, "/productos").status_code == 405

    assert _valor("http_server_requests_total", etiquetas) == antes + 3
    assert _valores_de("method") <= {"GET", "OTHER"}


def test_el_histograma_observa_con_la_plantilla(cliente: TestClient) -> None:
    etiquetas = {"method": "GET", "route": "/productos/{sku}"}
    antes = _valor("http_server_request_duration_seconds_count", etiquetas)

    cliente.get("/productos/TNG-0001")

    assert _valor("http_server_request_duration_seconds_count", etiquetas) == antes + 1
    assert _valor("http_server_request_duration_seconds_sum", etiquetas) > 0


def test_el_histograma_tiene_los_buckets_del_spec(cliente: TestClient) -> None:
    cliente.get("/productos")
    limites = {
        muestra.labels["le"]
        for familia in REGISTRY.collect()
        for muestra in familia.samples
        if muestra.name == "http_server_request_duration_seconds_bucket"
    }
    assert limites == {
        "0.005",
        "0.01",
        "0.025",
        "0.05",
        "0.1",
        "0.25",
        "0.5",
        "1.0",
        "2.5",
        "5.0",
        "+Inf",
    }


def test_metrics_y_salud_no_se_cuentan(cliente: TestClient) -> None:
    cliente.get("/metrics")
    cliente.get("/salud")

    rutas = _valores_de_route()
    assert "/metrics" not in rutas
    assert "/salud" not in rutas


def test_en_curso_vuelve_a_cero(cliente: TestClient) -> None:
    cliente.get("/productos")
    assert _valor("http_server_requests_in_flight") == 0


def test_busqueda_sin_resultados_incrementa_su_contador(cliente: TestClient) -> None:
    antes = _valor("catalog_searches_without_results_total")

    cliente.get("/productos/buscar", params={"q": "tamal"})
    assert _valor("catalog_searches_without_results_total") == antes

    cliente.get("/productos/buscar", params={"q": "piñata"})
    assert _valor("catalog_searches_without_results_total") == antes + 1


def test_agotados_por_categoria(cliente: TestClient) -> None:
    assert cliente.get("/salud").status_code == 200
    assert _valor("catalog_products_out_of_stock", {"category": "frutas-y-verduras"}) == 1
    assert _valor("catalog_products_out_of_stock", {"category": "artesanias"}) == 1
    assert _valor("catalog_products_out_of_stock", {"category": "antojitos"}) == 0


def test_metrics_expone_las_metricas_propias_y_las_de_plataforma(cliente: TestClient) -> None:
    cliente.get("/productos/TNG-0001")
    respuesta = cliente.get("/metrics")
    assert respuesta.status_code == 200
    assert respuesta.headers["content-type"].startswith("text/plain")
    texto = respuesta.text
    assert 'route="/productos/{sku}"' in texto
    assert "TNG-0001" not in texto
    assert "python_info" in texto
    assert "catalog_products_out_of_stock" in texto
