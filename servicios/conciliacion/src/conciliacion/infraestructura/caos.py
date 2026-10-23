"""Caos de conciliacion: la falla fallar, que se controla con un archivo de bandera.

conciliacion no tiene HTTP, así que no hay /caos. Mientras la bandera exista, cada corrida
falla a propósito con un error de dependencia simulado. La bandera puede traer una hora de
vencimiento; vencida, se ignora y se borra.

Dominio y aplicacion no conocen este módulo.
"""

import contextlib
import json
import os
import time
from collections.abc import Callable
from pathlib import Path

from conciliacion.aplicacion import DependenciaNoDisponibleError, PedidosPort
from conciliacion.dominio import Pedido

FALLAR = "fallar"

# Todas las fallas del job.
TIPOS = (FALLAR,)

DURACION_MINIMA = 1
DURACION_MAXIMA = 86_400


class CaosDeshabilitadoError(Exception):
    """El job arrancó con CAOS_TOKEN vacío: no se puede encender ninguna falla."""


class BanderaDeCaos:
    """El archivo de bandera. reloj devuelve la hora actual como unix time.

    Con habilitada en False el caos no es posible: encender falla y la bandera nunca cuenta
    como activa, aunque alguien cree el archivo a mano.
    """

    def __init__(
        self, archivo: str, reloj: Callable[[], float] = time.time, *, habilitada: bool = True
    ) -> None:
        self._archivo = Path(archivo)
        self._reloj = reloj
        self._habilitada = habilitada

    @property
    def habilitada(self) -> bool:
        return self._habilitada

    def encender(self, duracion_s: int | None = None) -> None:
        """Crea la bandera, o reemplaza la que había. Lanza ValueError si la duración no vale."""
        if not self._habilitada:
            raise CaosDeshabilitadoError("el contenedor arrancó con CAOS_TOKEN vacío")
        vence = None
        if duracion_s is not None:
            if not DURACION_MINIMA <= duracion_s <= DURACION_MAXIMA:
                raise ValueError(
                    f"duracion_s debe ser un entero entre {DURACION_MINIMA} y {DURACION_MAXIMA}"
                )
            vence = self._reloj() + duracion_s
        # Se escribe aparte y se renombra: nadie llega a leer la bandera a medio escribir.
        temporal = self._archivo.with_name(f"{self._archivo.name}.{os.getpid()}.tmp")
        temporal.write_text(json.dumps({"vence_en": vence}), encoding="utf-8")
        temporal.replace(self._archivo)

    def apagar(self) -> None:
        """Borra la bandera. Si no existía no pasa nada."""
        with contextlib.suppress(FileNotFoundError):
            self._archivo.unlink()

    def activa(self) -> bool:
        """Dice si la bandera existe y no venció. Una bandera vencida se borra."""
        if not self._habilitada or not self._archivo.exists():
            return False
        vence = self._vence()
        if vence is not None and self._reloj() >= vence:
            self.apagar()
            return False
        return True

    def restante(self) -> int | None:
        """Segundos que le quedan a la bandera. None si no vence o si está apagada."""
        if not self.activa():
            return None
        vence = self._vence()
        return None if vence is None else max(0, round(vence - self._reloj()))

    def _vence(self) -> float | None:
        """Lee la hora de vencimiento. Una bandera vacía o ilegible vale como sin vencimiento:
        basta con que el archivo exista para que la falla esté encendida."""
        try:
            contenido = json.loads(self._archivo.read_text(encoding="utf-8"))
        except OSError, ValueError:
            return None
        vence = contenido.get("vence_en") if isinstance(contenido, dict) else None
        return (
            float(vence) if isinstance(vence, int | float) and not isinstance(vence, bool) else None
        )


class PedidosConCaos:
    """Decorador de PedidosPort: con la bandera encendida, pedidos "no responde"."""

    def __init__(self, pedidos: PedidosPort, bandera: BanderaDeCaos) -> None:
        self._pedidos = pedidos
        self._bandera = bandera

    def confirmados(self) -> list[Pedido]:
        if self._bandera.activa():
            raise DependenciaNoDisponibleError("pedidos no respondió: falla simulada por caos")
        return self._pedidos.confirmados()
