"""Caos de conciliacion: la bandera, la falla fallar, su control y chaos_active."""

import json
import os
import subprocess
import sys
from collections.abc import Iterator
from decimal import Decimal
from pathlib import Path

import pytest

from conciliacion import caos
from conciliacion.aplicacion import DependenciaNoDisponibleError, PublicacionFallidaError
from conciliacion.dominio import Pedido, Resultado
from conciliacion.infraestructura.caos import (
    BanderaDeCaos,
    CaosDeshabilitadoError,
    PedidosConCaos,
)
from conciliacion.infraestructura.publicador_pushgateway import PublicadorPushgateway
from conciliacion.planificador import REINTENTO_DE_CAOS, Planificador, VigiaDeCaos
from conciliacion.registro import configurar_logs
from tests.servidor import Servidor, levantar
from tests.test_planificador import Guion, configuracion


class Reloj:
    """Reloj falso: avanza solo cuando la prueba lo dice."""

    def __init__(self) -> None:
        self.ahora = 1_791_770_000.0

    def __call__(self) -> float:
        return self.ahora


@pytest.fixture
def reloj() -> Reloj:
    return Reloj()


@pytest.fixture
def archivo(tmp_path: Path) -> Path:
    return tmp_path / "conciliacion.caos"


@pytest.fixture
def bandera(archivo: Path, reloj: Reloj) -> BanderaDeCaos:
    return BanderaDeCaos(str(archivo), reloj)


def mensajes(capsys: pytest.CaptureFixture[str]) -> list[dict[str, object]]:
    return [json.loads(linea) for linea in capsys.readouterr().out.splitlines()]


# --- La bandera ----------------------------------------------------------------------------


def test_la_bandera_arranca_apagada_y_se_enciende_y_apaga(
    bandera: BanderaDeCaos, archivo: Path
) -> None:
    assert not bandera.activa()

    bandera.encender()
    assert bandera.activa()
    assert bandera.restante() is None
    assert archivo.exists()

    bandera.apagar()
    bandera.apagar()
    assert not bandera.activa()
    assert not archivo.exists()


def test_con_duracion_la_bandera_vencida_se_ignora_y_se_borra(
    bandera: BanderaDeCaos, archivo: Path, reloj: Reloj
) -> None:
    bandera.encender(60)

    reloj.ahora += 59
    assert bandera.activa()
    assert bandera.restante() == 1

    reloj.ahora += 1
    assert not bandera.activa()
    assert bandera.restante() is None
    assert not archivo.exists()


def test_sin_duracion_la_bandera_no_vence(bandera: BanderaDeCaos, reloj: Reloj) -> None:
    bandera.encender()

    reloj.ahora += 10_000_000

    assert bandera.activa()


def test_encender_de_nuevo_reemplaza_la_duracion(bandera: BanderaDeCaos, reloj: Reloj) -> None:
    bandera.encender(60)
    bandera.encender()

    reloj.ahora += 3600

    assert bandera.activa()


@pytest.mark.parametrize("duracion", [0, -5, 86_401])
def test_una_duracion_fuera_de_rango_no_enciende_nada(
    bandera: BanderaDeCaos, duracion: int
) -> None:
    with pytest.raises(ValueError, match="entre 1 y 86400"):
        bandera.encender(duracion)

    assert not bandera.activa()


@pytest.mark.parametrize("duracion", [1, 86_400])
def test_los_limites_de_la_duracion_son_validos(bandera: BanderaDeCaos, duracion: int) -> None:
    bandera.encender(duracion)

    assert bandera.restante() == duracion


@pytest.mark.parametrize("contenido", ["", "no es json", "[]", '{"vence_en": "manana"}', "{}"])
def test_basta_con_que_el_archivo_exista(
    bandera: BanderaDeCaos, archivo: Path, contenido: str
) -> None:
    """La bandera se puede crear a mano con touch: una ilegible vale como sin vencimiento."""
    archivo.write_text(contenido)

    assert bandera.activa()
    assert bandera.restante() is None


# --- La falla ------------------------------------------------------------------------------


class PedidosDePrueba:
    def __init__(self) -> None:
        self.llamadas = 0

    def confirmados(self) -> list[Pedido]:
        self.llamadas += 1
        return [Pedido("PED-000001", "2026-10-12T03:00:00Z", Decimal("275.50"))]


def test_con_la_bandera_apagada_el_decorador_solo_pasa_la_llamada(
    bandera: BanderaDeCaos,
) -> None:
    pedidos = PedidosDePrueba()

    assert len(PedidosConCaos(pedidos, bandera).confirmados()) == 1
    assert pedidos.llamadas == 1


def test_con_la_bandera_encendida_falla_como_una_dependencia_caida(
    bandera: BanderaDeCaos,
) -> None:
    pedidos = PedidosDePrueba()
    bandera.encender()

    with pytest.raises(DependenciaNoDisponibleError, match="falla simulada por caos"):
        PedidosConCaos(pedidos, bandera).confirmados()

    assert pedidos.llamadas == 0


def test_vencida_la_bandera_la_corrida_vuelve_a_funcionar(
    bandera: BanderaDeCaos, reloj: Reloj
) -> None:
    pedidos = PedidosConCaos(PedidosDePrueba(), bandera)
    bandera.encender(900)

    reloj.ahora += 900

    assert len(pedidos.confirmados()) == 1


@pytest.fixture
def servicios() -> Iterator[Servidor]:
    """Un solo servidor que hace de pedidos, de pagos y de Pushgateway."""
    with levantar() as servidor:
        servidor.responder("/pedidos?estado=confirmado", {"total": 0, "pedidos": []})
        servidor.responder("/pagos", {"total": 0, "pagos": []})
        yield servidor


def correr(
    servicios: Servidor, archivo: Path, token: str = "llave-de-prueba"
) -> subprocess.CompletedProcess[str]:
    entorno = {
        "PEDIDOS_URL": servicios.url,
        "PAGOS_URL": servicios.url,
        "PUSHGATEWAY_URL": servicios.url,
        "CONCILIACION_TIMEOUT": "5",
        "CONCILIACION_BANDERA_DE_CAOS": str(archivo),
        "CAOS_TOKEN": token,
    }
    return subprocess.run(
        [sys.executable, "-m", "conciliacion"],
        env=entorno,
        capture_output=True,
        text=True,
        check=False,
        timeout=30,
    )


def test_una_corrida_con_la_bandera_falla_con_su_pushadd_y_su_log_normales(
    servicios: Servidor, archivo: Path
) -> None:
    archivo.touch()

    proceso = correr(servicios, archivo)

    assert proceso.returncode == 1
    fin = json.loads(proceso.stdout.splitlines()[-1])
    assert fin["msg"] == "conciliacion fallida"
    assert fin["result"] == "failure"
    assert fin["error"] == "pedidos no respondió: falla simulada por caos"
    # No se llamó a pedidos ni a pagos: solo el pushadd de la falla, que es un POST.
    ((metodo, ruta, cuerpo),) = servicios.peticiones
    assert (metodo, ruta) == ("POST", "/metrics/job/conciliacion")
    assert "conciliacion_last_run_success 0.0" in cuerpo
    assert "conciliacion_last_success_timestamp_seconds" not in cuerpo


def test_una_corrida_sin_la_bandera_sale_bien_y_empuja_chaos_active_en_0(
    servicios: Servidor, archivo: Path
) -> None:
    proceso = correr(servicios, archivo)

    assert proceso.returncode == 0
    metodo, ruta, cuerpo = servicios.peticiones[-1]
    assert (metodo, ruta) == ("PUT", "/metrics/job/conciliacion")
    assert 'chaos_active{type="fallar"} 0.0' in cuerpo


# --- Caos deshabilitado --------------------------------------------------------------------


def test_sin_token_la_bandera_no_se_puede_encender_ni_cuenta_aunque_exista(
    archivo: Path, reloj: Reloj
) -> None:
    deshabilitada = BanderaDeCaos(str(archivo), reloj, habilitada=False)

    with pytest.raises(CaosDeshabilitadoError):
        deshabilitada.encender()
    archivo.touch()

    assert not deshabilitada.activa()
    assert deshabilitada.restante() is None


def test_sin_token_una_corrida_ignora_la_bandera(servicios: Servidor, archivo: Path) -> None:
    archivo.touch()

    proceso = correr(servicios, archivo, token="")

    assert proceso.returncode == 0
    assert 'chaos_active{type="fallar"} 0.0' in servicios.peticiones[-1][2]


@pytest.mark.parametrize("argumentos", [["estado"], ["fallar"], ["fallar", "duracion_s=60"]])
def test_sin_token_el_control_sale_con_3(
    argumentos: list[str],
    archivo: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.setenv("CONCILIACION_BANDERA_DE_CAOS", str(archivo))
    monkeypatch.delenv("CAOS_TOKEN", raising=False)

    codigo = caos.ejecutar(argumentos)

    assert codigo == 3
    assert json.loads(capsys.readouterr().err)["error"] == "caos_deshabilitado"
    assert not archivo.exists()


# --- chaos_active --------------------------------------------------------------------------


class Empujador:
    def __init__(self) -> None:
        self.cuerpos: list[dict[str, float]] = []

    def __call__(self, _gateway: str, **argumentos: object) -> None:
        registro = argumentos["registry"]
        assert hasattr(registro, "collect")
        self.cuerpos.append(
            {
                muestra.name + "".join(f"|{v}" for v in muestra.labels.values()): muestra.value
                for familia in registro.collect()
                for muestra in familia.samples
            }
        )


def test_publicar_caos_usa_pushadd_solo_con_chaos_active() -> None:
    push, pushadd = Empujador(), Empujador()
    publicador = PublicadorPushgateway("http://pushgateway:9091", 5.0, push=push, pushadd=pushadd)

    publicador.publicar_caos(activo=True)
    publicador.publicar_caos(activo=False)

    # Nunca push: borraría las métricas de las corridas.
    assert push.cuerpos == []
    assert pushadd.cuerpos == [{"chaos_active|fallar": 1.0}, {"chaos_active|fallar": 0.0}]


def test_el_push_de_exito_lleva_chaos_active_con_el_estado_de_la_bandera(
    bandera: BanderaDeCaos,
) -> None:
    push = Empujador()
    publicador = PublicadorPushgateway(
        "http://pushgateway:9091", 5.0, push=push, pushadd=Empujador(), caos_activo=bandera.activa
    )
    resultado = Resultado(1, 0, 0, Decimal("10.00"))

    publicador.publicar_exito(resultado, instante=1.0, duracion=0.1)
    bandera.encender()
    publicador.publicar_exito(resultado, instante=2.0, duracion=0.1)

    assert [cuerpo["chaos_active|fallar"] for cuerpo in push.cuerpos] == [0.0, 1.0]


# --- El vigía del planificador -------------------------------------------------------------


class Publicaciones:
    def __init__(self) -> None:
        self.valores: list[bool] = []
        self.caido = False

    def __call__(self, activa: bool) -> None:
        if self.caido:
            raise PublicacionFallidaError("el Pushgateway no aceptó las métricas")
        self.valores.append(activa)


def test_el_vigia_publica_0_al_arrancar_y_despues_solo_los_cambios(
    bandera: BanderaDeCaos, capsys: pytest.CaptureFixture[str]
) -> None:
    configurar_logs()
    publicaciones = Publicaciones()
    vigia = VigiaDeCaos(bandera, publicaciones)

    vigia.revisar()
    vigia.revisar()
    assert publicaciones.valores == [False]
    assert mensajes(capsys) == []

    bandera.encender()
    vigia.revisar()
    vigia.revisar()
    bandera.apagar()
    vigia.revisar()

    assert publicaciones.valores == [False, True, False]
    lineas = mensajes(capsys)
    assert [linea["msg"] for linea in lineas] == ["caos activado", "caos apagado"]
    assert all(linea["chaos_type"] == "fallar" for linea in lineas)
    assert all(linea["level"] == "warning" for linea in lineas)


def test_el_vigia_distingue_el_vencimiento_del_apagado(
    bandera: BanderaDeCaos, reloj: Reloj, capsys: pytest.CaptureFixture[str]
) -> None:
    configurar_logs()
    publicaciones = Publicaciones()
    vigia = VigiaDeCaos(bandera, publicaciones)
    bandera.encender(3)

    for _ in range(4):
        vigia.revisar()
        reloj.ahora += 1

    assert publicaciones.valores == [True, False]
    assert [linea["msg"] for linea in mensajes(capsys)] == ["caos activado", "caos vencido"]


def test_si_el_pushgateway_no_responde_el_vigia_avisa_una_vez_y_reintenta_espaciado(
    bandera: BanderaDeCaos, capsys: pytest.CaptureFixture[str]
) -> None:
    configurar_logs()
    publicaciones = Publicaciones()
    publicaciones.caido = True
    cronometro = Reloj()
    vigia = VigiaDeCaos(bandera, publicaciones, cronometro)

    for _ in range(5):
        vigia.revisar()
        cronometro.ahora += 1
    assert [linea["msg"] for linea in mensajes(capsys)] == ["no se pudo publicar chaos_active"]

    publicaciones.caido = False
    vigia.revisar()
    assert publicaciones.valores == []

    cronometro.ahora += REINTENTO_DE_CAOS
    vigia.revisar()
    assert publicaciones.valores == [False]


def test_el_planificador_revisa_el_caos_cada_segundo_mientras_espera(tmp_path: Path) -> None:
    guion = Guion()
    revisiones: list[float] = []
    planificador = Planificador(
        configuracion(tmp_path / "latido"),
        lanzar=guion.lanzar,
        latir=guion.latir,
        cronometro=guion.cronometro,
        dormir=guion.dormir,
        revisar_caos=lambda: revisiones.append(guion.ahora),
    )
    guion.acciones.append((10.0, planificador.pedir_detener))

    planificador.planificar()

    assert revisiones == [float(segundo) for segundo in range(10)]


# --- El control ----------------------------------------------------------------------------


def controlar(
    argumentos: list[str],
    archivo: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> tuple[int, dict[str, object]]:
    monkeypatch.setenv("CONCILIACION_BANDERA_DE_CAOS", str(archivo))
    monkeypatch.setenv("CAOS_TOKEN", "llave-de-prueba")
    codigo = caos.ejecutar(argumentos)
    salida = capsys.readouterr()
    texto = salida.out if codigo == 0 else salida.err
    cuerpo: dict[str, object] = json.loads(texto)
    return codigo, cuerpo


def test_estado_muestra_la_falla_apagada(
    archivo: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    codigo, cuerpo = controlar(["estado"], archivo, monkeypatch, capsys)

    assert codigo == 0
    assert cuerpo == {
        "servicio": "conciliacion",
        "fallas": [{"tipo": "fallar", "activa": False, "restante_s": None, "parametros": {}}],
    }


def test_la_salida_va_sin_espacios_como_la_de_los_otros_servicios(
    archivo: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv("CONCILIACION_BANDERA_DE_CAOS", str(archivo))
    monkeypatch.setenv("CAOS_TOKEN", "llave-de-prueba")

    caos.ejecutar(["estado"])

    assert capsys.readouterr().out.strip() == (
        '{"servicio":"conciliacion","fallas":'
        '[{"tipo":"fallar","activa":false,"restante_s":null,"parametros":{}}]}'
    )


def test_fallar_enciende_con_o_sin_duracion_y_off_apaga(
    archivo: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    _, sin_duracion = controlar(["fallar"], archivo, monkeypatch, capsys)
    assert sin_duracion["fallas"] == [
        {"tipo": "fallar", "activa": True, "restante_s": None, "parametros": {}}
    ]

    _, con_duracion = controlar(["fallar", "duracion_s=900"], archivo, monkeypatch, capsys)
    assert con_duracion["fallas"] == [
        {"tipo": "fallar", "activa": True, "restante_s": 900, "parametros": {}}
    ]

    codigo, apagada = controlar(["fallar", "off"], archivo, monkeypatch, capsys)
    assert codigo == 0
    assert apagada["fallas"] == [
        {"tipo": "fallar", "activa": False, "restante_s": None, "parametros": {}}
    ]
    assert not archivo.exists()


def test_apagar_apaga_todo(
    archivo: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    controlar(["fallar"], archivo, monkeypatch, capsys)

    codigo, _ = controlar(["apagar"], archivo, monkeypatch, capsys)

    assert codigo == 0
    assert not archivo.exists()


@pytest.mark.parametrize(
    "argumentos",
    [
        [],
        ["latencia", "ms=800"],
        ["fallar", "duracion_s=0"],
        ["fallar", "duracion_s=86401"],
        ["fallar", "duracion_s=diez"],
        ["fallar", "duracion_s=1.5"],
        ["fallar", "duracion_s=-5"],
        ["fallar", "duracion_s"],
        ["fallar", "ms=800"],
        ["fallar", "off", "duracion_s=5"],
        ["estado", "ya"],
        ["apagar", "fallar"],
    ],
)
def test_argumentos_fuera_de_contrato_salen_con_2_y_no_cambian_nada(
    argumentos: list[str],
    archivo: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    codigo, cuerpo = controlar(argumentos, archivo, monkeypatch, capsys)

    assert codigo == 2
    assert cuerpo["error"] == "parametros_invalidos"
    assert not archivo.exists()


def test_como_proceso_el_control_enciende_la_bandera(archivo: Path) -> None:
    proceso = subprocess.run(
        [sys.executable, "-m", "conciliacion.caos", "fallar", "duracion_s=60"],
        env={
            **os.environ,
            "CONCILIACION_BANDERA_DE_CAOS": str(archivo),
            "CAOS_TOKEN": "llave-de-prueba",
        },
        capture_output=True,
        text=True,
        check=False,
        timeout=30,
    )

    assert proceso.returncode == 0
    assert '"activa":true' in proceso.stdout
    assert archivo.exists()
