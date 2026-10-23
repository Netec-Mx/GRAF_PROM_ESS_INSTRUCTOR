import json
import subprocess
import sys
from decimal import Decimal

import pytest

from conciliacion.__main__ import Piezas, correr_con_red, ejecutar, registrar_fin
from conciliacion.aplicacion import Conciliar, Corrida, PublicacionFallidaError
from conciliacion.dominio import Resultado
from conciliacion.registro import configurar_logs


def lineas(salida: str) -> list[dict[str, object]]:
    return [json.loads(linea) for linea in salida.splitlines()]


def test_linea_de_fin_de_una_corrida_exitosa(capsys: pytest.CaptureFixture[str]) -> None:
    configurar_logs()
    corrida = Corrida(
        exitosa=True, duracion=0.0421, resultado=Resultado(30, 10, 1, Decimal("1234.50"))
    )

    registrar_fin(corrida, "abc123def456")

    (linea,) = lineas(capsys.readouterr().out)
    assert linea["level"] == "info"
    assert linea["service"] == "conciliacion"
    assert linea["run_id"] == "abc123def456"
    assert linea["trigger"] == "direct"
    assert linea["result"] == "success"
    assert linea["duration_ms"] == 42.1
    assert linea["orders_checked"] == 30
    assert linea["orders_unpaid"] == 10
    assert linea["amount_mismatches"] == 1
    assert linea["approved_amount_mxn"] == "1234.50"
    assert linea["msg"] == "conciliacion terminada"
    assert "timestamp" in linea
    assert "error" not in linea


def test_linea_de_fin_de_una_corrida_fallida(capsys: pytest.CaptureFixture[str]) -> None:
    configurar_logs()

    registrar_fin(Corrida(exitosa=False, duracion=2.0, error="pedidos no respondió"), "abc123")

    (linea,) = lineas(capsys.readouterr().out)
    assert linea["level"] == "error"
    assert linea["result"] == "failure"
    assert linea["error"] == "pedidos no respondió"
    assert linea["msg"] == "conciliacion fallida"
    assert "orders_checked" not in linea


class ConciliarRoto(Conciliar):
    """Un caso de uso con un error de programación: lanza algo que nadie espera."""

    def __init__(self) -> None:
        pass

    def ejecutar(self) -> Corrida:
        raise RuntimeError("esto no debía pasar")


class PublicadorDePrueba:
    def __init__(self, caido: bool = False) -> None:
        self.caido = caido
        self.fallas: list[tuple[float, float]] = []
        self.exitos = 0

    def publicar_exito(self, _resultado: Resultado, _instante: float, _duracion: float) -> None:
        self.exitos += 1

    def publicar_falla(self, instante: float, duracion: float) -> None:
        if self.caido:
            raise PublicacionFallidaError("el Pushgateway no respondió")
        self.fallas.append((instante, duracion))


def test_la_red_publica_la_falla_ante_una_excepcion_inesperada(
    capsys: pytest.CaptureFixture[str],
) -> None:
    configurar_logs()
    publicador = PublicadorDePrueba()

    corrida = correr_con_red(Piezas(ConciliarRoto(), publicador))
    registrar_fin(corrida, "abc123", "manual")

    # La falla se publicó (pushadd con las 3 métricas), una sola vez, y nunca un éxito.
    assert len(publicador.fallas) == 1
    assert publicador.exitos == 0
    assert not corrida.exitosa
    assert corrida.error == "error inesperado: RuntimeError: esto no debía pasar"

    # Todo lo escrito es JSON: la traza va dentro del campo exception, no suelta.
    capturado = capsys.readouterr()
    assert capturado.err == ""
    inesperado, fin = lineas(capturado.out)
    assert inesperado["level"] == "error"
    assert inesperado["msg"] == "error inesperado en la corrida"
    assert "RuntimeError: esto no debía pasar" in str(inesperado["exception"])
    assert fin["msg"] == "conciliacion fallida"
    assert fin["result"] == "failure"
    assert fin["trigger"] == "manual"


def test_la_red_tambien_aguanta_que_falle_la_publicacion() -> None:
    configurar_logs()

    corrida = correr_con_red(Piezas(ConciliarRoto(), PublicadorDePrueba(caido=True)))

    assert not corrida.exitosa
    assert corrida.error is not None
    assert "RuntimeError" in corrida.error
    assert "no se pudo publicar la falla" in corrida.error


def test_con_la_red_el_proceso_sale_con_1_y_sin_traza_suelta(
    capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    publicador = PublicadorDePrueba()
    monkeypatch.setattr(
        "conciliacion.__main__.armar", lambda _config: Piezas(ConciliarRoto(), publicador)
    )

    codigo = ejecutar()

    capturado = capsys.readouterr()
    assert codigo == 1
    assert len(publicador.fallas) == 1
    assert capturado.err == ""
    assert [linea["msg"] for linea in lineas(capturado.out)] == [
        "conciliacion iniciada",
        "error inesperado en la corrida",
        "conciliacion fallida",
    ]


def test_una_corrida_sin_servicios_sale_con_1_y_deja_inicio_y_fin(
    capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    for variable in ("PEDIDOS_URL", "PAGOS_URL", "PUSHGATEWAY_URL"):
        monkeypatch.setenv(variable, "http://127.0.0.1:1")
    monkeypatch.setenv("CONCILIACION_TIMEOUT", "1")

    codigo = ejecutar()

    inicio, fin = lineas(capsys.readouterr().out)
    assert codigo == 1
    assert inicio["msg"] == "conciliacion iniciada"
    assert fin["msg"] == "conciliacion fallida"
    assert inicio["run_id"] == fin["run_id"]
    assert fin["result"] == "failure"


def test_configuracion_invalida_sale_con_1(
    capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("CONCILIACION_TIMEOUT", "rapido")

    assert ejecutar() == 1
    (linea,) = lineas(capsys.readouterr().out)
    assert linea["msg"] == "configuracion invalida"


def test_como_proceso_el_codigo_de_salida_es_1_si_falla() -> None:
    entorno = {
        "PEDIDOS_URL": "http://127.0.0.1:1",
        "PAGOS_URL": "http://127.0.0.1:1",
        "PUSHGATEWAY_URL": "http://127.0.0.1:1",
        "CONCILIACION_TIMEOUT": "1",
    }

    proceso = subprocess.run(
        [sys.executable, "-m", "conciliacion"],
        env=entorno,
        capture_output=True,
        text=True,
        check=False,
        timeout=30,
    )

    assert proceso.returncode == 1
    assert [linea["msg"] for linea in lineas(proceso.stdout)] == [
        "conciliacion iniciada",
        "conciliacion fallida",
    ]
