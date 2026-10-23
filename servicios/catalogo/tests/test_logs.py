import json
import logging

import pytest
from fastapi.testclient import TestClient

from catalogo.registro import FormateadorJson, configurar_logs


def _lineas(capsys: pytest.CaptureFixture[str]) -> list[dict[str, object]]:
    """Líneas de log de peticiones. El cliente HTTP de las pruebas escribe las suyas."""
    lineas = [json.loads(linea) for linea in capsys.readouterr().out.splitlines() if linea]
    return [linea for linea in lineas if "route" in linea]


def test_una_linea_json_por_peticion(
    cliente: TestClient, capsys: pytest.CaptureFixture[str]
) -> None:
    configurar_logs()
    cliente.get("/productos/TNG-0001")

    (linea,) = _lineas(capsys)
    assert list(linea) == [
        "timestamp",
        "level",
        "service",
        "method",
        "route",
        "status",
        "duration_ms",
        "msg",
    ]
    assert linea["service"] == "catalogo"
    assert linea["level"] == "info"
    assert linea["method"] == "GET"
    assert linea["route"] == "/productos/{sku}"
    assert linea["status"] == 200
    assert isinstance(linea["duration_ms"], float)


def test_un_404_se_registra_como_warning(
    cliente: TestClient, capsys: pytest.CaptureFixture[str]
) -> None:
    configurar_logs()
    cliente.get("/productos/TNG-9999")

    (linea,) = _lineas(capsys)
    assert linea["status"] == 404
    assert linea["level"] == "warning"
    assert linea["route"] == "/productos/{sku}"


def test_metrics_y_salud_no_generan_linea(
    cliente: TestClient, capsys: pytest.CaptureFixture[str]
) -> None:
    configurar_logs()
    cliente.get("/metrics")
    cliente.get("/salud")

    assert _lineas(capsys) == []


def test_un_log_sin_peticion_solo_lleva_los_campos_base() -> None:
    registro = logging.LogRecord("catalogo", logging.INFO, __file__, 1, "hola %s", ("mundo",), None)
    linea = json.loads(FormateadorJson().format(registro))
    assert list(linea) == ["timestamp", "level", "service", "msg"]
    assert linea["msg"] == "hola mundo"
