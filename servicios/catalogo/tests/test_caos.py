"""Caos: contrato de /caos, cada tipo de falla, vencimiento y la métrica chaos_active."""

import json
import logging

import pytest
from fastapi.testclient import TestClient
from prometheus_client import REGISTRY

from catalogo import metricas
from catalogo.api.caos import crear_inyector
from catalogo.api.rutas import RUTAS_DE_NEGOCIO
from catalogo.infraestructura import RepositorioEnMemoria
from catalogo.infraestructura.caos import (
    CARDINALIDAD,
    ERRORES,
    LATENCIA,
    MEMORIA,
    TIPOS,
    EstadoDeCaos,
    FallaDesconocidaError,
    Fuga,
    Motor,
    ParametrosInvalidosError,
)
from catalogo.main import crear_app
from catalogo.registro import configurar_logs

TOKEN = "token-de-prueba"
CABECERAS = {"X-Caos-Token": TOKEN}
MIB = 1024 * 1024


class Reloj:
    """Reloj falso: avanza solo cuando la prueba lo dice."""

    def __init__(self) -> None:
        self.ahora = 1000.0

    def __call__(self) -> float:
        return self.ahora


@pytest.fixture
def reloj() -> Reloj:
    return Reloj()


@pytest.fixture
def estado(reloj: Reloj) -> EstadoDeCaos:
    return EstadoDeCaos(RUTAS_DE_NEGOCIO, reloj)


@pytest.fixture
def cliente(repositorio: RepositorioEnMemoria, estado: EstadoDeCaos) -> TestClient:
    return TestClient(crear_app(repositorio, estado, TOKEN))


def _activa(tipo: str) -> float | None:
    return REGISTRY.get_sample_value("chaos_active", {"type": tipo})


def _peticiones(ruta: str, estado: str) -> float:
    etiquetas = {"method": "GET", "route": ruta, "status": estado}
    return REGISTRY.get_sample_value("http_server_requests_total", etiquetas) or 0.0


# --- Seguridad -----------------------------------------------------------------------------


@pytest.mark.parametrize("cabeceras", [{}, {"X-Caos-Token": "otro"}, {"X-Caos-Token": ""}])
@pytest.mark.parametrize(
    ("metodo", "ruta"),
    [
        ("GET", "/caos"),
        ("PUT", "/caos/latencia"),
        ("DELETE", "/caos/latencia"),
        ("DELETE", "/caos"),
    ],
)
def test_sin_token_o_con_otro_responde_401(
    cliente: TestClient, metodo: str, ruta: str, cabeceras: dict[str, str]
) -> None:
    respuesta = cliente.request(metodo, ruta, headers=cabeceras, json={"ms": 100})

    assert respuesta.status_code == 401
    assert respuesta.json()["error"] == "token_invalido"


def test_un_intento_rechazado_deja_su_linea_de_log_sin_el_token(
    cliente: TestClient, capsys: pytest.CaptureFixture[str]
) -> None:
    configurar_logs()
    capsys.readouterr()

    cliente.put("/caos/latencia", headers={"X-Caos-Token": "intento-secreto"}, json={"ms": 100})
    cliente.get("/caos")
    cliente.get("/caos", headers=CABECERAS)

    salida = capsys.readouterr().out
    lineas = [json.loads(texto) for texto in salida.splitlines()]
    rechazos = [linea for linea in lineas if linea["msg"] == "acceso a caos rechazado"]
    assert [(r["method"], r["route"], r["status"]) for r in rechazos] == [
        ("PUT", "/caos/{tipo}", 401),
        ("GET", "/caos", 401),
    ]
    assert all(r["service"] == "catalogo" and r["level"] == "warning" for r in rechazos)
    assert "intento-secreto" not in salida
    assert TOKEN not in salida


def test_sin_token_no_se_enciende_nada(cliente: TestClient, estado: EstadoDeCaos) -> None:
    cliente.put("/caos/latencia", json={"ms": 100})

    assert estado.vigente(LATENCIA) is None


@pytest.mark.parametrize(
    ("metodo", "ruta"),
    [
        ("GET", "/caos"),
        ("PUT", "/caos/latencia"),
        ("DELETE", "/caos/latencia"),
        ("DELETE", "/caos"),
    ],
)
def test_con_el_token_vacio_caos_no_existe(
    repositorio: RepositorioEnMemoria, metodo: str, ruta: str
) -> None:
    cliente = TestClient(crear_app(repositorio, token_de_caos=""))

    respuesta = cliente.request(metodo, ruta, headers={"X-Caos-Token": ""}, json={"ms": 100})

    assert respuesta.status_code == 404


def test_el_token_sale_de_la_variable_de_entorno(
    repositorio: RepositorioEnMemoria, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("CAOS_TOKEN", "del-entorno")
    cliente = TestClient(crear_app(repositorio))

    assert cliente.get("/caos", headers={"X-Caos-Token": "del-entorno"}).status_code == 200
    assert cliente.get("/caos", headers=CABECERAS).status_code == 401


def test_un_cuerpo_de_mas_de_4_kb_responde_413(cliente: TestClient, estado: EstadoDeCaos) -> None:
    cuerpo = json.dumps({"ms": 100, "ruta": "x" * 4096})

    respuesta = cliente.put("/caos/latencia", headers=CABECERAS, content=cuerpo)

    assert respuesta.status_code == 413
    assert estado.vigente(LATENCIA) is None


# --- Contrato ------------------------------------------------------------------------------


def test_get_lista_todas_las_fallas_apagadas(cliente: TestClient) -> None:
    respuesta = cliente.get("/caos", headers=CABECERAS)

    assert respuesta.status_code == 200
    assert respuesta.json() == {
        "servicio": "catalogo",
        "fallas": [
            {"tipo": tipo, "activa": False, "restante_s": None, "parametros": {}}
            for tipo in ("latencia", "errores", "cardinalidad", "memoria")
        ],
    }


def test_put_activa_y_devuelve_los_parametros_con_sus_valores_por_defecto(
    cliente: TestClient,
) -> None:
    respuesta = cliente.put("/caos/latencia", headers=CABECERAS, json={"ms": 800})

    assert respuesta.status_code == 200
    assert respuesta.json() == {
        "tipo": "latencia",
        "activa": True,
        "restante_s": None,
        "parametros": {"ms": 800, "jitter_ms": 0, "porcentaje": 100},
    }


def test_put_reemplaza_la_falla_que_habia(cliente: TestClient) -> None:
    cliente.put("/caos/errores", headers=CABECERAS, json={"porcentaje": 30, "status": 503})

    respuesta = cliente.put(
        "/caos/errores", headers=CABECERAS, json={"ruta": "/productos", "duracion_s": 60}
    )

    assert respuesta.json() == {
        "tipo": "errores",
        "activa": True,
        "restante_s": 60,
        "parametros": {"porcentaje": 100, "status": 500, "ruta": "/productos"},
    }


def test_put_sin_cuerpo_vale_para_una_falla_sin_parametros(cliente: TestClient) -> None:
    respuesta = cliente.put("/caos/cardinalidad", headers=CABECERAS)

    assert respuesta.status_code == 200
    assert respuesta.json()["activa"] is True


def test_delete_apaga_una_y_delete_de_todo_apaga_todas(cliente: TestClient) -> None:
    cliente.put("/caos/latencia", headers=CABECERAS, json={"ms": 800})
    cliente.put("/caos/cardinalidad", headers=CABECERAS, json={})

    una = cliente.delete("/caos/latencia", headers=CABECERAS)
    assert una.status_code == 200
    assert una.json()["activa"] is False
    activas = [
        f["tipo"] for f in cliente.get("/caos", headers=CABECERAS).json()["fallas"] if f["activa"]
    ]
    assert activas == ["cardinalidad"]

    todas = cliente.delete("/caos", headers=CABECERAS)
    assert todas.status_code == 200
    assert not any(f["activa"] for f in todas.json()["fallas"])


def test_apagar_una_falla_apagada_no_es_un_error(cliente: TestClient) -> None:
    assert cliente.delete("/caos/memoria", headers=CABECERAS).status_code == 200


@pytest.mark.parametrize("metodo", ["PUT", "DELETE"])
def test_un_tipo_que_no_existe_responde_404(cliente: TestClient, metodo: str) -> None:
    respuesta = cliente.request(metodo, "/caos/pasarela_lenta", headers=CABECERAS, json={})

    assert respuesta.status_code == 404
    assert respuesta.json()["error"] == "falla_desconocida"


# --- Validación ----------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("tipo", "cuerpo"),
    [
        (LATENCIA, {}),
        (LATENCIA, {"ms": 0}),
        (LATENCIA, {"ms": 10001}),
        (LATENCIA, {"ms": "800"}),
        (LATENCIA, {"ms": 800.5}),
        (LATENCIA, {"ms": True}),
        (LATENCIA, {"ms": 800, "jitter_ms": -1}),
        (LATENCIA, {"ms": 800, "jitter_ms": 5001}),
        (LATENCIA, {"ms": 800, "porcentaje": 0}),
        (LATENCIA, {"ms": 800, "porcentaje": 101}),
        (LATENCIA, {"ms": 800, "ruta": "/productos/TNG-0001"}),
        (LATENCIA, {"ms": 800, "ruta": "/salud"}),
        (LATENCIA, {"ms": 800, "status": 503}),
        (LATENCIA, {"ms": 800, "duracion_s": 0}),
        (LATENCIA, {"ms": 800, "duracion_s": 86401}),
        (LATENCIA, {"ms": 800, "inventado": 1}),
        (LATENCIA, [800]),
        (ERRORES, {"porcentaje": 0}),
        (ERRORES, {"status": 404}),
        (ERRORES, {"status": 200}),
        (ERRORES, {"status": "503"}),
        (ERRORES, {"ruta": 5}),
        (CARDINALIDAD, {"ms": 1}),
        (MEMORIA, {}),
        (MEMORIA, {"mb_por_minuto": 0}),
        (MEMORIA, {"mb_por_minuto": 201}),
    ],
)
def test_parametros_fuera_de_contrato_responden_400(
    cliente: TestClient, estado: EstadoDeCaos, tipo: str, cuerpo: object
) -> None:
    respuesta = cliente.put(f"/caos/{tipo}", headers=CABECERAS, json=cuerpo)

    assert respuesta.status_code == 400
    assert respuesta.json()["error"] == "parametros_invalidos"
    assert estado.vigente(tipo) is None


def test_un_cuerpo_que_no_es_json_responde_400(cliente: TestClient) -> None:
    respuesta = cliente.put("/caos/latencia", headers=CABECERAS, content="ms=800")

    assert respuesta.status_code == 400


@pytest.mark.parametrize(
    ("tipo", "cuerpo"),
    [
        (LATENCIA, {"ms": 1, "jitter_ms": 0, "porcentaje": 1}),
        (LATENCIA, {"ms": 10000, "jitter_ms": 5000, "porcentaje": 100, "duracion_s": 86400}),
        (ERRORES, {"porcentaje": 1, "status": 504, "ruta": "/productos/{sku}", "duracion_s": 1}),
        (MEMORIA, {"mb_por_minuto": 1}),
        (MEMORIA, {"mb_por_minuto": 200}),
    ],
)
def test_los_limites_de_cada_rango_son_validos(
    estado: EstadoDeCaos, tipo: str, cuerpo: object
) -> None:
    estado.activar(tipo, cuerpo)

    assert estado.vigente(tipo) is not None


def test_el_estado_rechaza_tipos_que_no_existen(estado: EstadoDeCaos) -> None:
    with pytest.raises(FallaDesconocidaError):
        estado.activar("fallar", {})
    with pytest.raises(FallaDesconocidaError):
        estado.apagar("fallar")
    with pytest.raises(ParametrosInvalidosError):
        estado.activar(LATENCIA, None)


# --- Fallas --------------------------------------------------------------------------------


class Siesta:
    """Reemplaza a asyncio.sleep y recuerda cuánto le pidieron dormir."""

    def __init__(self) -> None:
        self.segundos: list[float] = []

    async def __call__(self, segundos: float) -> None:
        self.segundos.append(segundos)


class Azar:
    """Devuelve siempre el mismo sorteo."""

    def __init__(self, sorteo: float) -> None:
        self.sorteo = sorteo

    def __call__(self) -> float:
        return self.sorteo


def _con_inyector(
    repositorio: RepositorioEnMemoria, estado: EstadoDeCaos, siesta: Siesta, azar: Azar
) -> TestClient:
    """La app con la siesta y el azar de prueba en las rutas de negocio."""
    return TestClient(crear_app(repositorio, estado, TOKEN, crear_inyector(estado, siesta, azar)))


def test_latencia_demora_las_rutas_de_negocio(
    repositorio: RepositorioEnMemoria, estado: EstadoDeCaos
) -> None:
    siesta = Siesta()
    cliente = _con_inyector(repositorio, estado, siesta, Azar(0.5))
    estado.activar(LATENCIA, {"ms": 800, "jitter_ms": 200})

    assert cliente.get("/productos/TNG-0001").status_code == 200
    assert cliente.get("/productos").status_code == 200

    # 800 ms fijos más la mitad del jitter, porque el sorteo es 0.5.
    assert siesta.segundos == [0.9, 0.9]


def test_latencia_respeta_el_porcentaje(
    repositorio: RepositorioEnMemoria, estado: EstadoDeCaos
) -> None:
    siesta, azar = Siesta(), Azar(0.29)
    cliente = _con_inyector(repositorio, estado, siesta, azar)
    estado.activar(LATENCIA, {"ms": 500, "porcentaje": 30})

    cliente.get("/productos")
    azar.sorteo = 0.30
    cliente.get("/productos")

    assert siesta.segundos == [0.5]


def test_latencia_con_ruta_solo_afecta_a_esa_plantilla(
    repositorio: RepositorioEnMemoria, estado: EstadoDeCaos
) -> None:
    siesta = Siesta()
    cliente = _con_inyector(repositorio, estado, siesta, Azar(0.0))
    estado.activar(LATENCIA, {"ms": 500, "ruta": "/productos/{sku}"})

    cliente.get("/productos")
    cliente.get("/productos/buscar", params={"q": "tamal"})
    assert siesta.segundos == []

    cliente.get("/productos/TNG-0007")
    assert siesta.segundos == [0.5]


def test_errores_responde_el_status_pedido_y_lo_cuenta_con_la_plantilla(
    repositorio: RepositorioEnMemoria, estado: EstadoDeCaos
) -> None:
    cliente = _con_inyector(repositorio, estado, Siesta(), Azar(0.0))
    estado.activar(ERRORES, {"status": 503})
    antes = _peticiones("/productos/{sku}", "503")

    respuesta = cliente.get("/productos/TNG-0001")

    assert respuesta.status_code == 503
    assert respuesta.json() == {"error": "error_inyectado", "mensaje": "Error inyectado por caos"}
    assert _peticiones("/productos/{sku}", "503") == antes + 1


def test_errores_respeta_el_porcentaje(
    repositorio: RepositorioEnMemoria, estado: EstadoDeCaos
) -> None:
    azar = Azar(0.29)
    cliente = _con_inyector(repositorio, estado, Siesta(), azar)
    estado.activar(ERRORES, {"porcentaje": 30, "status": 502})

    assert cliente.get("/productos").status_code == 502
    azar.sorteo = 0.30
    assert cliente.get("/productos").status_code == 200


def test_las_fallas_no_tocan_salud_ni_metrics_ni_caos(
    repositorio: RepositorioEnMemoria, estado: EstadoDeCaos
) -> None:
    siesta = Siesta()
    cliente = _con_inyector(repositorio, estado, siesta, Azar(0.0))
    estado.activar(LATENCIA, {"ms": 10000})
    estado.activar(ERRORES, {"status": 500})

    assert cliente.get("/salud").status_code == 200
    assert cliente.get("/metrics").status_code == 200
    assert cliente.get("/caos", headers=CABECERAS).status_code == 200
    assert siesta.segundos == []


def test_cardinalidad_pone_la_ruta_real_en_la_etiqueta_y_al_apagarla_vuelve_la_plantilla(
    cliente: TestClient, estado: EstadoDeCaos
) -> None:
    plantilla_antes = _peticiones("/productos/{sku}", "200")
    estado.activar(CARDINALIDAD, {})

    cliente.get("/productos/TNG-0001")
    cliente.get("/productos/TNG-8888")

    try:
        assert _peticiones("/productos/TNG-0001", "200") == 1
        assert _peticiones("/productos/TNG-8888", "404") == 1
        assert _peticiones("/productos/{sku}", "200") == plantilla_antes

        estado.apagar(CARDINALIDAD)
        cliente.get("/productos/TNG-0001")

        assert _peticiones("/productos/TNG-0001", "200") == 1
        assert _peticiones("/productos/{sku}", "200") == plantilla_antes + 1
    finally:
        # El registro de métricas es global: las series con sku no deben quedar para otras pruebas.
        for ruta, status in (("/productos/TNG-0001", "200"), ("/productos/TNG-8888", "404")):
            metricas.PETICIONES.remove("GET", ruta, status)
            metricas.DURACION.remove("GET", ruta)


def test_cardinalidad_no_cambia_las_peticiones_sin_ruta(
    cliente: TestClient, estado: EstadoDeCaos
) -> None:
    estado.activar(CARDINALIDAD, {})
    antes = _peticiones("unmatched", "404")

    cliente.get("/no-existe/123")

    assert _peticiones("unmatched", "404") == antes + 1
    assert _peticiones("/no-existe/123", "404") == 0


def test_memoria_retiene_al_ritmo_pedido_y_suelta_al_apagar(estado: EstadoDeCaos) -> None:
    fuga = Fuga()
    motor = Motor(estado, fuga)
    estado.activar(MEMORIA, {"mb_por_minuto": 60})

    motor.avanzar(1.0)
    motor.avanzar(1.0)
    assert fuga.retenido == 2 * MIB

    estado.apagar(MEMORIA)
    motor.avanzar(1.0)
    assert fuga.retenido == 0


def test_memoria_no_pierde_los_bytes_que_no_completan_un_paso(estado: EstadoDeCaos) -> None:
    fuga = Fuga()
    estado.activar(MEMORIA, {"mb_por_minuto": 1})

    for _ in range(60):
        Motor(estado, fuga).avanzar(1.0)

    assert MIB - 60 <= fuga.retenido <= MIB


# --- Vencimiento ---------------------------------------------------------------------------


def test_con_duracion_la_falla_se_apaga_sola(cliente: TestClient, reloj: Reloj) -> None:
    cliente.put("/caos/errores", headers=CABECERAS, json={"status": 503, "duracion_s": 60})

    reloj.ahora += 59
    assert cliente.get("/productos").status_code == 503
    (errores,) = [
        f for f in cliente.get("/caos", headers=CABECERAS).json()["fallas"] if f["activa"]
    ]
    assert errores["restante_s"] == 1

    reloj.ahora += 1
    assert cliente.get("/productos").status_code == 200
    assert not any(f["activa"] for f in cliente.get("/caos", headers=CABECERAS).json()["fallas"])


def test_sin_duracion_la_falla_no_vence(estado: EstadoDeCaos, reloj: Reloj) -> None:
    estado.activar(LATENCIA, {"ms": 100})

    reloj.ahora += 10_000_000

    assert estado.vigente(LATENCIA) is not None
    assert estado.barrer() == []


def test_barrer_apaga_las_vencidas_y_lo_deja_en_el_log(
    estado: EstadoDeCaos, reloj: Reloj, capsys: pytest.CaptureFixture[str]
) -> None:
    configurar_logs()
    estado.activar(LATENCIA, {"ms": 100, "duracion_s": 30})
    estado.activar(CARDINALIDAD, {})
    capsys.readouterr()

    reloj.ahora += 30

    assert estado.barrer() == [LATENCIA]
    assert estado.barrer() == []
    (linea,) = [json.loads(texto) for texto in capsys.readouterr().out.splitlines()]
    assert linea["msg"] == "caos vencido"
    assert linea["chaos_type"] == "latencia"
    assert linea["level"] == "warning"
    assert estado.vigente(CARDINALIDAD) is not None


def test_el_motor_suelta_la_memoria_cuando_la_fuga_vence(
    estado: EstadoDeCaos, reloj: Reloj
) -> None:
    fuga = Fuga()
    motor = Motor(estado, fuga)
    estado.activar(MEMORIA, {"mb_por_minuto": 60, "duracion_s": 10})
    motor.avanzar(1.0)
    assert fuga.retenido == MIB

    reloj.ahora += 10
    motor.avanzar(1.0)

    assert fuga.retenido == 0


# --- Logs y métricas -----------------------------------------------------------------------


def test_cada_cambio_deja_una_linea_de_log_y_caos_no_deja_linea_de_peticion(
    cliente: TestClient, capsys: pytest.CaptureFixture[str]
) -> None:
    configurar_logs()
    logging.getLogger("httpx2").setLevel(logging.WARNING)
    capsys.readouterr()

    cliente.put(
        "/caos/latencia", headers=CABECERAS, json={"ms": 800, "porcentaje": 50, "duracion_s": 600}
    )
    cliente.get("/caos", headers=CABECERAS)
    cliente.delete("/caos/latencia", headers=CABECERAS)
    cliente.delete("/caos/latencia", headers=CABECERAS)

    lineas = [json.loads(texto) for texto in capsys.readouterr().out.splitlines()]
    lineas = [linea for linea in lineas if linea["msg"].startswith(("caos", "peticion"))]
    assert [linea["msg"] for linea in lineas] == ["caos activado", "caos apagado"]
    assert lineas[0]["chaos_type"] == "latencia"
    assert lineas[0]["params"] == {"ms": 800, "jitter_ms": 0, "porcentaje": 50}
    assert lineas[0]["duration_s"] == 600
    assert lineas[1]["chaos_type"] == "latencia"


def test_caos_no_cuenta_en_las_metricas_http(cliente: TestClient) -> None:
    def muestras_de_caos() -> list[str]:
        return [
            muestra.labels["route"]
            for familia in REGISTRY.collect()
            for muestra in familia.samples
            if "caos" in muestra.labels.get("route", "")
        ]

    cliente.get("/caos", headers=CABECERAS)
    cliente.put("/caos/cardinalidad", headers=CABECERAS, json={})
    cliente.get("/caos")
    cliente.delete("/caos", headers=CABECERAS)

    assert muestras_de_caos() == []


def test_chaos_active_tiene_una_serie_por_falla_y_sigue_al_estado(
    cliente: TestClient, reloj: Reloj
) -> None:
    assert {tipo: _activa(tipo) for tipo in TIPOS} == dict.fromkeys(TIPOS, 0.0)

    cliente.put("/caos/latencia", headers=CABECERAS, json={"ms": 800, "duracion_s": 60})
    assert _activa("latencia") == 1.0
    assert _activa("errores") == 0.0

    reloj.ahora += 60
    assert _activa("latencia") == 0.0


def test_chaos_active_existe_aunque_el_caos_este_deshabilitado(
    repositorio: RepositorioEnMemoria,
) -> None:
    crear_app(repositorio, token_de_caos="")

    assert {tipo: _activa(tipo) for tipo in TIPOS} == dict.fromkeys(TIPOS, 0.0)


def test_el_motor_corre_mientras_la_app_esta_viva(
    repositorio: RepositorioEnMemoria, estado: EstadoDeCaos, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("catalogo.main.PASO_DEL_CAOS", 0.01)
    estado.activar(MEMORIA, {"mb_por_minuto": 1})

    with TestClient(crear_app(repositorio, estado, TOKEN)) as cliente:
        assert cliente.get("/salud").status_code == 200
