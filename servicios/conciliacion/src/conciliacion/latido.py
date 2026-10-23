"""Latido del planificador y su chequeo de salud: python -m conciliacion.latido.

El planificador toca un archivo en cada ciclo. El healthcheck del contenedor corre este
módulo, que sale con 0 si el archivo se tocó hace menos de dos intervalos y con 1 si no.
Usa el mismo Python de la imagen; no hace falta ninguna herramienta extra.
"""

import sys
import time
from pathlib import Path

from conciliacion.configuracion import leer

INTERVALOS_TOLERADOS = 2


def tocar(archivo: str) -> None:
    """Marca que el planificador sigue vivo."""
    Path(archivo).touch()


def vivo(archivo: str, intervalo: float, ahora: float) -> bool:
    """Dice si el latido es más reciente que dos intervalos."""
    try:
        edad = ahora - Path(archivo).stat().st_mtime
    except OSError:
        return False
    return edad < INTERVALOS_TOLERADOS * intervalo


def chequear() -> int:
    try:
        config = leer()
    except ValueError:
        return 1
    return 0 if vivo(config.archivo_de_latido, config.intervalo, time.time()) else 1


if __name__ == "__main__":
    sys.exit(chequear())
