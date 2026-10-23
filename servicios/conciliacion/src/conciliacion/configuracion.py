"""Configuración por variables de entorno."""

import os
from collections.abc import Mapping
from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class Configuracion:
    pedidos_url: str
    pagos_url: str
    pushgateway_url: str
    timeout: float
    intervalo: float
    primera_espera: float
    # Se concilian los pedidos creados entre ahora - ventana y ahora - gracia, en segundos.
    ventana: float
    gracia: float
    archivo_de_latido: str
    bandera_de_caos: str
    # Falso si CAOS_TOKEN está vacío: sin token no hay caos posible, igual que en los otros.
    caos_habilitado: bool


def leer(entorno: Mapping[str, str] | None = None) -> Configuracion:
    """Lee la configuración. Lanza ValueError si un número no es válido."""
    variables = os.environ if entorno is None else entorno
    ventana = _positivo(variables, "CONCILIACION_VENTANA_S", 900.0)
    gracia = _positivo(variables, "CONCILIACION_GRACIA_S", 60.0, admite_cero=True)
    if gracia >= ventana:
        raise ValueError(
            f"CONCILIACION_GRACIA_S ({gracia:g}) debe ser menor que "
            f"CONCILIACION_VENTANA_S ({ventana:g})"
        )
    return Configuracion(
        pedidos_url=variables.get("PEDIDOS_URL", "http://pedidos:8080"),
        pagos_url=variables.get("PAGOS_URL", "http://pagos:8080"),
        pushgateway_url=variables.get("PUSHGATEWAY_URL", "http://pushgateway:9091"),
        timeout=_positivo(variables, "CONCILIACION_TIMEOUT", 5.0),
        intervalo=_positivo(variables, "CONCILIACION_INTERVALO", 300.0),
        primera_espera=_positivo(variables, "CONCILIACION_PRIMERA_ESPERA", 30.0),
        ventana=ventana,
        gracia=gracia,
        archivo_de_latido=variables.get("CONCILIACION_LATIDO", "/tmp/conciliacion.latido"),
        bandera_de_caos=variables.get("CONCILIACION_BANDERA_DE_CAOS", "/tmp/conciliacion.caos"),
        caos_habilitado=bool(variables.get("CAOS_TOKEN", "")),
    )


def _positivo(
    variables: Mapping[str, str], nombre: str, por_defecto: float, *, admite_cero: bool = False
) -> float:
    texto = variables.get(nombre, "")
    if not texto:
        return por_defecto
    try:
        valor = float(texto)
    except ValueError:
        raise ValueError(f"{nombre} debe ser un número de segundos, llegó {texto!r}") from None
    if valor < 0 or (valor == 0 and not admite_cero):
        minimo = "cero o más" if admite_cero else "mayor que cero"
        raise ValueError(f"{nombre} debe ser {minimo}, llegó {texto!r}")
    return valor
