import json
import logging
import os
import signal
import subprocess
import sys
import time
from collections.abc import Callable
from pathlib import Path

import pytest

from conciliacion import latido
from conciliacion.configuracion import Configuracion, leer
from conciliacion.planificador import Planificador


def configuracion(archivo: Path, intervalo: float = 300.0, primera: float = 30.0) -> Configuracion:
    return Configuracion(
        pedidos_url="http://pedidos:8080",
        pagos_url="http://pagos:8080",
        pushgateway_url="http://pushgateway:9091",
        timeout=5.0,
        intervalo=intervalo,
        primera_espera=primera,
        ventana=900.0,
        gracia=60.0,
        archivo_de_latido=str(archivo),
        bandera_de_caos=str(archivo.with_name("caos")),
        caos_habilitado=True,
    )


class Guion:
    """Reloj y espera de mentira para el planificador.

    dormir no espera: adelanta el reloj. En los instantes indicados dispara una acción, como
    haría una señal que llega en mitad de la espera.
    """

    def __init__(self) -> None:
        self.ahora = 0.0
        self.corridas: list[tuple[float, str]] = []
        self.latidos = 0
        self.acciones: list[tuple[float, Callable[[], None]]] = []
        self.al_correr: Callable[[], None] | None = None

    def cronometro(self) -> float:
        return self.ahora

    def dormir(self, segundos: float) -> None:
        self.ahora += segundos
        pendientes = [accion for instante, accion in self.acciones if instante <= self.ahora]
        self.acciones = [(i, a) for i, a in self.acciones if i > self.ahora]
        for accion in pendientes:
            accion()

    def lanzar(self, origen: str, _timeout: float) -> int:
        self.corridas.append((self.ahora, origen))
        if self.al_correr is not None:
            self.al_correr()
        # Cada corrida tarda un segundo.
        self.ahora += 1.0
        return 0

    def latir(self, _archivo: str) -> None:
        self.latidos += 1

    def planificador(self, tmp_path: Path) -> Planificador:
        return Planificador(
            configuracion(tmp_path / "latido"),
            lanzar=self.lanzar,
            latir=self.latir,
            cronometro=self.cronometro,
            dormir=self.dormir,
        )


def test_primera_corrida_a_los_30_segundos_y_despues_una_por_intervalo(tmp_path: Path) -> None:
    guion = Guion()
    planificador = guion.planificador(tmp_path)
    guion.acciones.append((700.0, planificador.pedir_detener))

    planificador.planificar()

    # 30 s de espera; cada corrida tarda 1 s y la siguiente sale 300 s después de que termina.
    assert guion.corridas == [(30.0, "scheduled"), (331.0, "scheduled"), (632.0, "scheduled")]
    # El latido se toca cada 5 s durante la espera y después de cada corrida.
    assert 130 < guion.latidos < 160


def test_sigusr1_lanza_una_corrida_inmediata_sin_mover_la_planificada(tmp_path: Path) -> None:
    guion = Guion()
    planificador = guion.planificador(tmp_path)
    guion.acciones.append((100.0, planificador.pedir_corrida_manual))
    guion.acciones.append((400.0, planificador.pedir_detener))

    planificador.planificar()

    assert guion.corridas == [(30.0, "scheduled"), (100.0, "manual"), (331.0, "scheduled")]


def test_una_corrida_manual_antes_de_la_primera_planificada(tmp_path: Path) -> None:
    guion = Guion()
    planificador = guion.planificador(tmp_path)
    guion.acciones.append((10.0, planificador.pedir_corrida_manual))
    guion.acciones.append((40.0, planificador.pedir_detener))

    planificador.planificar()

    assert guion.corridas == [(10.0, "manual"), (30.0, "scheduled")]


def test_un_pedido_manual_con_una_corrida_en_curso_se_ignora_y_queda_en_el_log(
    tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    guion = Guion()
    planificador = guion.planificador(tmp_path)
    # La señal llega mientras la corrida planificada está corriendo.
    guion.al_correr = planificador.pedir_corrida_manual
    guion.acciones.append((60.0, planificador.pedir_detener))

    with caplog.at_level(logging.INFO, logger="conciliacion.planificador"):
        planificador.planificar()

    assert guion.corridas == [(30.0, "scheduled")]
    assert "corrida manual ignorada: ya habia una corrida en curso" in caplog.messages
    assert "corrida manual solicitada" not in caplog.messages


def test_una_corrida_fallida_no_detiene_el_planificador(tmp_path: Path) -> None:
    guion = Guion()
    codigos = iter([1, 0])
    corridas: list[str] = []

    def lanzar(origen: str, _timeout: float) -> int:
        corridas.append(origen)
        return next(codigos)

    planificador = Planificador(
        configuracion(tmp_path / "latido"),
        lanzar=lanzar,
        latir=guion.latir,
        cronometro=guion.cronometro,
        dormir=guion.dormir,
    )
    guion.acciones.append((340.0, planificador.pedir_detener))

    planificador.planificar()

    assert corridas == ["scheduled", "scheduled"]


def test_si_piden_detener_durante_la_espera_no_lanza_nada(tmp_path: Path) -> None:
    guion = Guion()
    planificador = guion.planificador(tmp_path)
    guion.acciones.append((10.0, planificador.pedir_detener))

    planificador.planificar()

    assert guion.corridas == []


def test_cien_senales_seguidas_no_cuelgan_al_planificador(tmp_path: Path) -> None:
    """Regresión: un manejador que tomaba un candado podía dejar colgado al proceso."""
    entorno = {
        **os.environ,
        "PEDIDOS_URL": "http://127.0.0.1:1",
        "PAGOS_URL": "http://127.0.0.1:1",
        "PUSHGATEWAY_URL": "http://127.0.0.1:1",
        "CONCILIACION_TIMEOUT": "1",
        "CONCILIACION_PRIMERA_ESPERA": "600",
        "CONCILIACION_LATIDO": str(tmp_path / "latido"),
        "CONCILIACION_BANDERA_DE_CAOS": str(tmp_path / "caos"),
    }
    proceso = subprocess.Popen(
        [sys.executable, "-m", "conciliacion.planificador"],
        env=entorno,
        stdout=subprocess.PIPE,
        text=True,
    )
    try:
        assert proceso.stdout is not None
        assert "planificador iniciado" in proceso.stdout.readline()
        for _ in range(100):
            proceso.send_signal(signal.SIGUSR1)
            time.sleep(0.002)
        # Margen para que el bucle note la señal (lo revisa cada 0.25 s) y lance la corrida.
        time.sleep(1.5)
    finally:
        proceso.terminate()
        salida, _ = proceso.communicate(timeout=20)

    # Terminó solo con SIGTERM, sin colgarse, y dejó su línea de despedida.
    assert proceso.returncode == 0
    mensajes = [json.loads(linea)["msg"] for linea in salida.splitlines()]
    assert mensajes[-1] == "planificador detenido"
    assert "corrida manual solicitada" in mensajes


def test_la_senal_usr1_de_verdad_lanza_una_corrida_manual(tmp_path: Path) -> None:
    """El proceso real: se le manda SIGUSR1 y corre en el momento, con trigger manual."""
    entorno = {
        **os.environ,
        "PEDIDOS_URL": "http://127.0.0.1:1",
        "PAGOS_URL": "http://127.0.0.1:1",
        "PUSHGATEWAY_URL": "http://127.0.0.1:1",
        "CONCILIACION_TIMEOUT": "1",
        "CONCILIACION_PRIMERA_ESPERA": "600",
        "CONCILIACION_LATIDO": str(tmp_path / "latido"),
        "CONCILIACION_BANDERA_DE_CAOS": str(tmp_path / "caos"),
    }
    proceso = subprocess.Popen(
        [sys.executable, "-m", "conciliacion.planificador"],
        env=entorno,
        stdout=subprocess.PIPE,
        text=True,
    )
    try:
        assert proceso.stdout is not None
        assert "planificador iniciado" in proceso.stdout.readline()
        proceso.send_signal(signal.SIGUSR1)
        lineas: list[dict[str, object]] = []
        while len(lineas) < 3:
            linea = json.loads(proceso.stdout.readline())
            # Sin Pushgateway, el vigía de caos avisa una vez que no pudo publicar.
            if linea["msg"] != "no se pudo publicar chaos_active":
                lineas.append(linea)
    finally:
        proceso.terminate()
        proceso.wait(timeout=10)

    assert [linea["msg"] for linea in lineas] == [
        "corrida manual solicitada",
        "conciliacion iniciada",
        "conciliacion fallida",
    ]
    assert lineas[1]["trigger"] == "manual"
    assert lineas[2]["trigger"] == "manual"
    assert lineas[2]["result"] == "failure"
    assert proceso.returncode == 0


def test_el_latido_esta_vivo_si_tiene_menos_de_dos_intervalos(tmp_path: Path) -> None:
    archivo = tmp_path / "latido"
    assert not latido.vivo(str(archivo), 300.0, time.time())

    latido.tocar(str(archivo))
    tocado = archivo.stat().st_mtime

    assert latido.vivo(str(archivo), 300.0, tocado + 1)
    assert latido.vivo(str(archivo), 300.0, tocado + 599)
    assert not latido.vivo(str(archivo), 300.0, tocado + 600)
    assert not latido.vivo(str(archivo), 300.0, tocado + 3600)


def test_el_chequeo_de_salud_sale_con_0_o_1(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    archivo = tmp_path / "latido"
    monkeypatch.setenv("CONCILIACION_LATIDO", str(archivo))
    monkeypatch.setenv("CONCILIACION_INTERVALO", "300")

    assert latido.chequear() == 1

    latido.tocar(str(archivo))
    assert latido.chequear() == 0

    viejo = time.time() - 601
    os.utime(archivo, (viejo, viejo))
    assert latido.chequear() == 1

    monkeypatch.setenv("CONCILIACION_INTERVALO", "no-es-numero")
    assert latido.chequear() == 1


def test_configuracion_por_defecto_y_por_entorno() -> None:
    por_defecto = leer({})
    assert por_defecto.pedidos_url == "http://pedidos:8080"
    assert por_defecto.pagos_url == "http://pagos:8080"
    assert por_defecto.pushgateway_url == "http://pushgateway:9091"
    assert por_defecto.intervalo == 300.0
    assert por_defecto.primera_espera == 30.0

    propia = leer({"CONCILIACION_INTERVALO": "60", "PEDIDOS_URL": "http://localhost:8002"})
    assert propia.intervalo == 60.0
    assert propia.pedidos_url == "http://localhost:8002"


@pytest.mark.parametrize("valor", ["cinco", "0", "-3"])
def test_un_intervalo_invalido_se_rechaza(valor: str) -> None:
    with pytest.raises(ValueError, match="CONCILIACION_INTERVALO"):
        leer({"CONCILIACION_INTERVALO": valor})
