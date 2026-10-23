"""Utilidades compartidas por los middlewares."""

from starlette.types import Scope

# Rutas de plataforma: no se cuentan en las métricas HTTP ni generan línea de log.
RUTAS_EXCLUIDAS = frozenset({"/metrics", "/salud"})
RUTA_DE_CAOS = "/caos"


def ruta_excluida(ruta: str) -> bool:
    """Dice si la ruta es de plataforma: /metrics, /salud o /caos y lo que cuelga de ella."""
    return ruta in RUTAS_EXCLUIDAS or ruta == RUTA_DE_CAOS or ruta.startswith(f"{RUTA_DE_CAOS}/")


# Valor fijo para peticiones que no coinciden con ninguna ruta. Así un escaneo de
# URLs inventadas no crea una serie por cada una.
RUTA_DESCONOCIDA = "unmatched"


# Métodos HTTP que se aceptan como valor de etiqueta. El método llega tal cual lo
# manda el cliente, así que sin esta lista cada método inventado crearía una serie.
METODOS_CONOCIDOS = frozenset(
    {"GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "CONNECT", "TRACE"}
)
METODO_DESCONOCIDO = "OTHER"


def metodo_acotado(scope: Scope) -> str:
    """Devuelve el método HTTP si es uno conocido; si no, un valor fijo."""
    metodo = str(scope["method"]).upper()
    return metodo if metodo in METODOS_CONOCIDOS else METODO_DESCONOCIDO


def plantilla_de_ruta(scope: Scope) -> str:
    """Devuelve la plantilla de la ruta (/productos/{sku}), nunca la ruta real.

    El enrutador deja la ruta que coincidió en scope["route"], así que esto solo
    da un resultado útil después de que la aplicación atendió la petición.
    """
    plantilla = getattr(scope.get("route"), "path", None)
    return plantilla if isinstance(plantilla, str) else RUTA_DESCONOCIDA


def ruta_real(scope: Scope) -> str:
    """Devuelve la ruta tal como llegó (/productos/TNG-0001) si coincidió con alguna ruta.

    Solo la usa la falla cardinalidad. Las peticiones sin ruta siguen como RUTA_DESCONOCIDA.
    """
    if plantilla_de_ruta(scope) == RUTA_DESCONOCIDA:
        return RUTA_DESCONOCIDA
    return str(scope["path"])
