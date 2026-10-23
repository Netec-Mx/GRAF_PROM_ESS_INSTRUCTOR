"""Estado de las fallas de caos del servicio.

Vive solo en memoria: un reinicio del proceso apaga todas las fallas.
Dominio y aplicacion no conocen este módulo.
"""

import logging
import threading
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass

_log = logging.getLogger("catalogo.caos")

LATENCIA = "latencia"
ERRORES = "errores"
CARDINALIDAD = "cardinalidad"
MEMORIA = "memoria"

# Todas las fallas del servicio, en el orden en que se muestran.
TIPOS = (LATENCIA, ERRORES, CARDINALIDAD, MEMORIA)

ESTADOS_DE_ERROR = (500, 502, 503, 504)

_MIB = 1024 * 1024

type Parametros = Mapping[str, int | str]


class FallaDesconocidaError(Exception):
    """El tipo de falla no existe en este servicio."""


class ParametrosInvalidosError(Exception):
    """El cuerpo no cumple el contrato del tipo de falla."""


@dataclass(frozen=True, slots=True)
class _Entero:
    """Rango de un parámetro entero. Sin por_defecto, el parámetro es obligatorio."""

    minimo: int
    maximo: int
    por_defecto: int | None = None


_PORCENTAJE = _Entero(1, 100, 100)
_DURACION = _Entero(1, 86_400)

_ENTEROS: Mapping[str, Mapping[str, _Entero]] = {
    LATENCIA: {
        "ms": _Entero(1, 10_000),
        "jitter_ms": _Entero(0, 5_000, 0),
        "porcentaje": _PORCENTAJE,
    },
    ERRORES: {"porcentaje": _PORCENTAJE},
    CARDINALIDAD: {},
    MEMORIA: {"mb_por_minuto": _Entero(1, 200)},
}

# Fallas que se pueden limitar a una sola ruta.
_CON_RUTA = frozenset({LATENCIA, ERRORES})


@dataclass(frozen=True, slots=True)
class Falla:
    """Una falla encendida. vence es un instante del reloj del estado, o None si no vence."""

    tipo: str
    parametros: Parametros
    vence: float | None

    def entero(self, nombre: str) -> int:
        valor = self.parametros[nombre]
        if not isinstance(valor, int):
            raise TypeError(f"{nombre} no es un entero")
        return valor

    def aplica_a(self, ruta: str) -> bool:
        """Dice si la falla alcanza a esa plantilla de ruta."""
        limitada_a = self.parametros.get("ruta")
        return limitada_a is None or limitada_a == ruta


class EstadoDeCaos:
    """Qué fallas están encendidas. Seguro para usarse desde varios hilos.

    reloj devuelve segundos de un reloj que solo avanza. Se inyecta para probar duracion_s
    sin esperar.
    """

    def __init__(self, rutas: frozenset[str], reloj: Callable[[], float] = time.monotonic) -> None:
        self._rutas = rutas
        self._reloj = reloj
        self._candado = threading.Lock()
        self._fallas: dict[str, Falla] = {}

    def activar(self, tipo: str, cuerpo: object) -> Falla:
        """Enciende una falla o reemplaza la que había de ese tipo."""
        parametros, duracion = self._validar(tipo, cuerpo)
        vence = None if duracion is None else self._reloj() + duracion
        falla = Falla(tipo, parametros, vence)
        with self._candado:
            self._fallas[tipo] = falla
        campos: dict[str, object] = {"chaos_type": tipo, "params": dict(parametros)}
        if duracion is not None:
            campos["duration_s"] = duracion
        _log.warning("caos activado", extra=campos)
        return falla

    def apagar(self, tipo: str) -> None:
        """Apaga una falla. Si ya estaba apagada no pasa nada."""
        if tipo not in TIPOS:
            raise FallaDesconocidaError(tipo)
        with self._candado:
            estaba = self._fallas.pop(tipo, None)
        if estaba is not None:
            _log.warning("caos apagado", extra={"chaos_type": tipo})

    def apagar_todo(self) -> None:
        for tipo in TIPOS:
            self.apagar(tipo)

    def vigente(self, tipo: str) -> Falla | None:
        """Devuelve la falla si está encendida y no venció."""
        with self._candado:
            falla = self._fallas.get(tipo)
        if falla is None or (falla.vence is not None and self._reloj() >= falla.vence):
            return None
        return falla

    def barrer(self) -> list[str]:
        """Apaga las fallas vencidas, lo deja en el log y devuelve sus tipos."""
        ahora = self._reloj()
        with self._candado:
            vencidas = [
                tipo
                for tipo, falla in self._fallas.items()
                if falla.vence is not None and ahora >= falla.vence
            ]
            for tipo in vencidas:
                del self._fallas[tipo]
        for tipo in vencidas:
            _log.warning("caos vencido", extra={"chaos_type": tipo})
        return vencidas

    def resumen(self) -> list[dict[str, object]]:
        """El estado de todas las fallas, como lo devuelve GET /caos."""
        ahora = self._reloj()
        return [self.describir(tipo, ahora) for tipo in TIPOS]

    def describir(self, tipo: str, ahora: float | None = None) -> dict[str, object]:
        falla = self.vigente(tipo)
        if falla is None:
            return {"tipo": tipo, "activa": False, "restante_s": None, "parametros": {}}
        instante = self._reloj() if ahora is None else ahora
        restante = None if falla.vence is None else max(0, round(falla.vence - instante))
        return {
            "tipo": tipo,
            "activa": True,
            "restante_s": restante,
            "parametros": dict(falla.parametros),
        }

    def _validar(self, tipo: str, cuerpo: object) -> tuple[dict[str, int | str], int | None]:
        if tipo not in TIPOS:
            raise FallaDesconocidaError(tipo)
        if not isinstance(cuerpo, dict):
            raise ParametrosInvalidosError("el cuerpo debe ser un objeto JSON")
        enteros = _ENTEROS[tipo]
        permitidos = {*enteros, "duracion_s"}
        if tipo in _CON_RUTA:
            permitidos.add("ruta")
        if tipo == ERRORES:
            permitidos.add("status")
        sobran = sorted(str(clave) for clave in cuerpo if clave not in permitidos)
        if sobran:
            raise ParametrosInvalidosError(
                f"parámetros que {tipo} no admite: {', '.join(sobran)}. "
                f"Admite: {', '.join(sorted(permitidos))}"
            )

        parametros: dict[str, int | str] = {}
        for nombre, rango in enteros.items():
            valor = _entero(cuerpo, nombre, rango)
            if valor is not None:
                parametros[nombre] = valor
        if tipo == ERRORES:
            status = cuerpo.get("status", ESTADOS_DE_ERROR[0])
            if type(status) is not int or status not in ESTADOS_DE_ERROR:
                raise ParametrosInvalidosError("status debe ser 500, 502, 503 o 504")
            parametros["status"] = status
        if "ruta" in cuerpo:
            ruta = cuerpo["ruta"]
            if ruta not in self._rutas:
                raise ParametrosInvalidosError(
                    f"ruta debe ser una plantilla de negocio: {', '.join(sorted(self._rutas))}"
                )
            parametros["ruta"] = str(ruta)
        return parametros, _entero(cuerpo, "duracion_s", _DURACION, obligatorio=False)


def _entero(
    cuerpo: Mapping[object, object], nombre: str, rango: _Entero, *, obligatorio: bool = True
) -> int | None:
    if nombre not in cuerpo:
        if rango.por_defecto is not None or not obligatorio:
            return rango.por_defecto
        raise ParametrosInvalidosError(f"falta {nombre}")
    valor = cuerpo[nombre]
    # bool es subclase de int: true no cuenta como número.
    if type(valor) is not int or not rango.minimo <= valor <= rango.maximo:
        raise ParametrosInvalidosError(
            f"{nombre} debe ser un entero entre {rango.minimo} y {rango.maximo}"
        )
    return valor


class Fuga:
    """Memoria que se retiene sin liberarla: la falla memoria."""

    def __init__(self) -> None:
        self._bloques: list[bytes] = []
        self._pendiente = 0.0

    @property
    def retenido(self) -> int:
        """Bytes retenidos hasta ahora."""
        return sum(len(bloque) for bloque in self._bloques)

    def retener(self, mb_por_minuto: int, segundos: float) -> None:
        """Retiene lo que corresponde a ese lapso."""
        self._pendiente += mb_por_minuto * _MIB * segundos / 60
        cantidad = int(self._pendiente)
        if cantidad > 0:
            self._pendiente -= cantidad
            # Bytes distintos de cero: el sistema tiene que respaldarlos con memoria real.
            self._bloques.append(b"\x01" * cantidad)

    def soltar(self) -> None:
        self._bloques.clear()
        self._pendiente = 0.0


class Motor:
    """Lo que el caos hace con el paso del tiempo: vencer fallas y hacer crecer la fuga."""

    def __init__(self, estado: EstadoDeCaos, fuga: Fuga) -> None:
        self._estado = estado
        self._fuga = fuga

    def avanzar(self, segundos: float) -> None:
        self._estado.barrer()
        falla = self._estado.vigente(MEMORIA)
        if falla is None:
            self._fuga.soltar()
        else:
            self._fuga.retener(falla.entero("mb_por_minuto"), segundos)
