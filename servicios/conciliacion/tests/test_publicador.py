from collections.abc import Iterator
from decimal import Decimal

import pytest
from prometheus_client import CollectorRegistry

from conciliacion.aplicacion import PublicacionFallidaError
from conciliacion.dominio import Resultado
from conciliacion.infraestructura.publicador_pushgateway import PublicadorPushgateway
from tests.servidor import Servidor, levantar

RESULTADO = Resultado(
    pedidos_revisados=30, pedidos_sin_pago=10, montos_distintos=1, monto_aprobado=Decimal("1234.56")
)

LAS_8 = {
    "conciliacion_last_success_timestamp_seconds",
    "conciliacion_last_run_timestamp_seconds",
    "conciliacion_last_run_success",
    "conciliacion_last_run_duration_seconds",
    "conciliacion_orders_checked",
    "conciliacion_orders_unpaid",
    "conciliacion_amount_mismatches",
    "conciliacion_approved_amount_mxn",
}

LAS_3_DE_UNA_FALLA = {
    "conciliacion_last_run_timestamp_seconds",
    "conciliacion_last_run_success",
    "conciliacion_last_run_duration_seconds",
}


class Empujador:
    """Reemplaza a push_to_gateway o pushadd_to_gateway y recuerda con qué lo llamaron."""

    def __init__(self, error: Exception | None = None) -> None:
        self.llamadas: list[dict[str, object]] = []
        self._error = error

    def __call__(self, gateway: str, **argumentos: object) -> None:
        self.llamadas.append({"gateway": gateway, **argumentos})
        if self._error is not None:
            raise self._error

    def metricas(self) -> dict[str, float]:
        registro = self.llamadas[0]["registry"]
        assert isinstance(registro, CollectorRegistry)
        return {
            muestra.name: muestra.value
            for familia in registro.collect()
            for muestra in familia.samples
        }


def test_en_exito_usa_push_con_las_8_metricas() -> None:
    push, pushadd = Empujador(), Empujador()
    publicador = PublicadorPushgateway("http://pushgateway:9091", 5.0, push=push, pushadd=pushadd)

    publicador.publicar_exito(RESULTADO, instante=1_791_770_000.0, duracion=0.25)

    assert pushadd.llamadas == []
    assert len(push.llamadas) == 1
    assert push.llamadas[0]["gateway"] == "http://pushgateway:9091"
    assert push.llamadas[0]["job"] == "conciliacion"
    assert push.llamadas[0]["timeout"] == 5.0
    assert push.metricas() == {
        "conciliacion_last_success_timestamp_seconds": 1_791_770_000.0,
        "conciliacion_last_run_timestamp_seconds": 1_791_770_000.0,
        "conciliacion_last_run_success": 1.0,
        "conciliacion_last_run_duration_seconds": 0.25,
        "conciliacion_orders_checked": 30.0,
        "conciliacion_orders_unpaid": 10.0,
        "conciliacion_amount_mismatches": 1.0,
        "conciliacion_approved_amount_mxn": 1234.56,
        "chaos_active": 0.0,
    }
    assert set(push.metricas()) == LAS_8 | {"chaos_active"}


def test_en_falla_usa_pushadd_con_solo_3_metricas() -> None:
    push, pushadd = Empujador(), Empujador()
    publicador = PublicadorPushgateway("http://pushgateway:9091", 5.0, push=push, pushadd=pushadd)

    publicador.publicar_falla(instante=1_791_770_300.0, duracion=2.0)

    # Nunca push en una falla: borraría conciliacion_last_success_timestamp_seconds.
    assert push.llamadas == []
    assert len(pushadd.llamadas) == 1
    assert pushadd.llamadas[0]["job"] == "conciliacion"
    assert pushadd.metricas() == {
        "conciliacion_last_run_timestamp_seconds": 1_791_770_300.0,
        "conciliacion_last_run_success": 0.0,
        "conciliacion_last_run_duration_seconds": 2.0,
    }
    assert set(pushadd.metricas()) == LAS_3_DE_UNA_FALLA
    assert "conciliacion_last_success_timestamp_seconds" not in pushadd.metricas()


def test_si_el_pushgateway_no_responde_avisa_con_su_propio_error() -> None:
    caido = Empujador(error=ConnectionRefusedError("connection refused"))
    publicador = PublicadorPushgateway("http://pushgateway:9091", 5.0, push=caido, pushadd=caido)

    with pytest.raises(PublicacionFallidaError, match="connection refused"):
        publicador.publicar_exito(RESULTADO, instante=1.0, duracion=1.0)
    with pytest.raises(PublicacionFallidaError):
        publicador.publicar_falla(instante=1.0, duracion=1.0)


@pytest.fixture
def pushgateway() -> Iterator[Servidor]:
    with levantar() as servidor:
        yield servidor


def test_contra_un_pushgateway_http_el_exito_es_put_y_la_falla_es_post(
    pushgateway: Servidor,
) -> None:
    """Con prometheus_client real: push es un PUT (reemplaza el grupo) y pushadd es un POST."""
    publicador = PublicadorPushgateway(pushgateway.url, 5.0)

    publicador.publicar_exito(RESULTADO, instante=1_791_770_000.0, duracion=0.25)
    publicador.publicar_falla(instante=1_791_770_300.0, duracion=2.0)

    (metodo_exito, ruta_exito, cuerpo_exito), (metodo_falla, ruta_falla, cuerpo_falla) = (
        pushgateway.peticiones
    )
    assert (metodo_exito, ruta_exito) == ("PUT", "/metrics/job/conciliacion")
    assert (metodo_falla, ruta_falla) == ("POST", "/metrics/job/conciliacion")
    assert all(f"\n{nombre} " in cuerpo_exito for nombre in LAS_8)
    assert "conciliacion_last_run_success 0.0" in cuerpo_falla
    assert "conciliacion_last_success_timestamp_seconds" not in cuerpo_falla
    assert "conciliacion_orders_unpaid" not in cuerpo_falla


def test_un_pushgateway_que_no_existe_da_error_de_publicacion() -> None:
    publicador = PublicadorPushgateway("http://127.0.0.1:1", 1.0)

    with pytest.raises(PublicacionFallidaError):
        publicador.publicar_exito(RESULTADO, instante=1.0, duracion=1.0)
