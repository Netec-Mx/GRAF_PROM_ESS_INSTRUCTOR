"""Publica el resultado de cada corrida en el Pushgateway.

Aquí está la regla que sostiene la lección de la falla silenciosa:

- Corrida exitosa: push. Reemplaza el grupo completo con las 8 métricas, más chaos_active.
- Corrida fallida: pushadd, y solo con 3 métricas. pushadd reemplaza únicamente las métricas
  que se mandan y deja las demás como estaban, así last_success_timestamp conserva la hora de
  la última vez que salió bien.

Si en la falla se usara push, el grupo quedaría solo con esas 3 métricas: se borraría el
timestamp de éxito y la alerta de "no corre bien hace X" quedaría ciega.

chaos_active dice si la falla de caos del job está encendida. Va en el push de éxito porque
ese push reemplaza el grupo entero: si no fuera, la serie desaparecería. Entre corridas la
mantiene al día el planificador, con publicar_caos.
"""

from collections.abc import Callable

from prometheus_client import CollectorRegistry, Gauge, push_to_gateway, pushadd_to_gateway

from conciliacion.aplicacion import PublicacionFallidaError
from conciliacion.dominio import Resultado
from conciliacion.infraestructura.caos import FALLAR

GRUPO = "conciliacion"

# Firma común de push_to_gateway y pushadd_to_gateway, para poder reemplazarlas en las pruebas.
type Empujador = Callable[..., None]


class PublicadorPushgateway:
    """Implementa PublicadorPort con prometheus_client."""

    def __init__(
        self,
        url: str,
        timeout: float,
        push: Empujador = push_to_gateway,
        pushadd: Empujador = pushadd_to_gateway,
        caos_activo: Callable[[], bool] = lambda: False,
    ) -> None:
        self._url = url
        self._timeout = timeout
        self._push = push
        self._pushadd = pushadd
        self._caos_activo = caos_activo

    def publicar_exito(self, resultado: Resultado, instante: float, duracion: float) -> None:
        registro = CollectorRegistry()
        self._ultima_corrida(registro, instante, duracion, exitosa=True)
        _gauge(
            registro,
            "conciliacion_last_success_timestamp_seconds",
            "Unix time de la última corrida exitosa.",
            instante,
        )
        _gauge(
            registro,
            "conciliacion_orders_checked",
            "Pedidos confirmados de la ventana, en la última corrida exitosa.",
            resultado.pedidos_revisados,
        )
        _gauge(
            registro,
            "conciliacion_orders_unpaid",
            "Pedidos confirmados de la ventana sin pago aprobado.",
            resultado.pedidos_sin_pago,
        )
        _gauge(
            registro,
            "conciliacion_amount_mismatches",
            "Pagos aprobados cuyo monto no coincide con el total de su pedido.",
            resultado.montos_distintos,
        )
        _gauge(
            registro,
            "conciliacion_approved_amount_mxn",
            "Monto aprobado de los pedidos de la ventana, en pesos mexicanos.",
            # El float solo se usa para la métrica. La suma se hizo con Decimal.
            float(resultado.monto_aprobado),
        )
        _caos(registro, activo=self._caos_activo())
        # push: reemplaza todo el grupo.
        self._empujar(self._push, registro)

    def publicar_falla(self, instante: float, duracion: float) -> None:
        registro = CollectorRegistry()
        self._ultima_corrida(registro, instante, duracion, exitosa=False)
        # pushadd: reemplaza solo estas 3 métricas y conserva las demás del grupo.
        self._empujar(self._pushadd, registro)

    def publicar_caos(self, *, activo: bool) -> None:
        """Publica solo chaos_active, sin tocar las métricas de las corridas."""
        registro = CollectorRegistry()
        _caos(registro, activo=activo)
        # pushadd: reemplaza solo esta métrica y conserva las demás del grupo.
        self._empujar(self._pushadd, registro)

    @staticmethod
    def _ultima_corrida(
        registro: CollectorRegistry, instante: float, duracion: float, *, exitosa: bool
    ) -> None:
        """Las 3 métricas que se publican siempre, salga bien o mal la corrida."""
        _gauge(
            registro,
            "conciliacion_last_run_timestamp_seconds",
            "Unix time de la última corrida, exitosa o no.",
            instante,
        )
        _gauge(
            registro,
            "conciliacion_last_run_success",
            "1 si la última corrida fue exitosa, 0 si falló.",
            1 if exitosa else 0,
        )
        _gauge(
            registro,
            "conciliacion_last_run_duration_seconds",
            "Duración de la última corrida, en segundos.",
            duracion,
        )

    def _empujar(self, empujador: Empujador, registro: CollectorRegistry) -> None:
        try:
            empujador(self._url, job=GRUPO, registry=registro, timeout=self._timeout)
        except (OSError, ValueError) as error:
            raise PublicacionFallidaError(
                f"el Pushgateway no aceptó las métricas: {error}"
            ) from error


def _gauge(registro: CollectorRegistry, nombre: str, ayuda: str, valor: float) -> None:
    Gauge(nombre, ayuda, registry=registro).set(valor)


def _caos(registro: CollectorRegistry, *, activo: bool) -> None:
    Gauge(
        "chaos_active",
        "Fallas de caos del job: 1 si está encendida, 0 si no.",
        ["type"],
        registry=registro,
    ).labels(type=FALLAR).set(1 if activo else 0)
