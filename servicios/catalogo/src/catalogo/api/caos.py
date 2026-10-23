"""Entrada HTTP del caos: las rutas /caos y la inyección de fallas en las rutas de negocio."""

import asyncio
import hmac
import json
import logging
import random
from collections.abc import Awaitable, Callable

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from catalogo.api.comun import metodo_acotado, plantilla_de_ruta
from catalogo.infraestructura.caos import (
    ERRORES,
    LATENCIA,
    EstadoDeCaos,
    Falla,
    FallaDesconocidaError,
    ParametrosInvalidosError,
)

_log = logging.getLogger("catalogo.caos")

CABECERA_DEL_TOKEN = "X-Caos-Token"
MAXIMO_DE_CUERPO = 4 * 1024

type Dormir = Callable[[float], Awaitable[None]]
# Devuelve un número al azar en [0, 1).
type Azar = Callable[[], float]
type Inyector = Callable[[Request], Awaitable[None]]


class ErrorInyectadoError(Exception):
    """La falla errores decidió que esta petición falla."""

    def __init__(self, status: int) -> None:
        super().__init__(f"error {status} inyectado por caos")
        self.status = status


class RechazoDeCaosError(Exception):
    """/caos rechazó la petición: token, tamaño o JSON."""

    def __init__(self, status: int, codigo: str, mensaje: str) -> None:
        super().__init__(mensaje)
        self.respuesta = _error(status, codigo, mensaje)


def _error(status: int, codigo: str, mensaje: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": codigo, "mensaje": mensaje})


def respuesta_de_error_inyectado(error: ErrorInyectadoError) -> JSONResponse:
    return _error(error.status, "error_inyectado", "Error inyectado por caos")


def crear_inyector(
    estado: EstadoDeCaos, dormir: Dormir = asyncio.sleep, azar: Azar = random.random
) -> Inyector:
    """Dependencia de las rutas de negocio: aplica latencia y errores.

    Corre después de que el enrutador eligió la ruta, así conoce su plantilla. Va por dentro
    de los middlewares de métricas y de logs, que ven la demora y el código de error.
    """

    def le_toca(falla: Falla | None, ruta: str) -> bool:
        return (
            falla is not None and falla.aplica_a(ruta) and azar() * 100 < falla.entero("porcentaje")
        )

    async def inyectar(request: Request) -> None:
        ruta = plantilla_de_ruta(request.scope)
        latencia = estado.vigente(LATENCIA)
        if latencia is not None and le_toca(latencia, ruta):
            ms = latencia.entero("ms") + azar() * latencia.entero("jitter_ms")
            await dormir(ms / 1000)
        errores = estado.vigente(ERRORES)
        if errores is not None and le_toca(errores, ruta):
            raise ErrorInyectadoError(errores.entero("status"))

    return inyectar


async def _leer_cuerpo(request: Request) -> object:
    """Lee el cuerpo JSON con tope de 4 KB. Un cuerpo vacío vale como {}."""
    demasiado = RechazoDeCaosError(
        413, "cuerpo_demasiado_grande", "El cuerpo no puede pasar de 4 KB"
    )
    declarado = request.headers.get("content-length", "")
    if declarado.isdigit() and int(declarado) > MAXIMO_DE_CUERPO:
        raise demasiado
    cuerpo = b""
    async for trozo in request.stream():
        cuerpo += trozo
        if len(cuerpo) > MAXIMO_DE_CUERPO:
            raise demasiado
    if not cuerpo.strip():
        return {}
    try:
        return json.loads(cuerpo)
    except ValueError:
        raise RechazoDeCaosError(
            400, "parametros_invalidos", "El cuerpo debe ser un objeto JSON"
        ) from None


def crear_rutas_de_caos(estado: EstadoDeCaos, token: str) -> APIRouter:
    """Rutas /caos. Solo se montan si hay token; sin token, /caos no existe."""

    def exigir_token(request: Request) -> None:
        recibido = request.headers.get(CABECERA_DEL_TOKEN, "")
        # compare_digest tarda lo mismo acierte o no: no deja adivinar el token por tiempos.
        if not hmac.compare_digest(recibido.encode(), token.encode()):
            # El intento queda en el log, sin el token que mandaron.
            _log.warning(
                "acceso a caos rechazado",
                extra={
                    "method": metodo_acotado(request.scope),
                    "route": plantilla_de_ruta(request.scope),
                    "status": 401,
                },
            )
            raise RechazoDeCaosError(
                401, "token_invalido", f"Falta {CABECERA_DEL_TOKEN} o no coincide"
            )

    rutas = APIRouter(dependencies=[Depends(exigir_token)], include_in_schema=False)

    def todas() -> JSONResponse:
        return JSONResponse({"servicio": "catalogo", "fallas": estado.resumen()})

    @rutas.get("/caos")
    def ver() -> JSONResponse:
        return todas()

    @rutas.put("/caos/{tipo}")
    async def activar(tipo: str, request: Request) -> JSONResponse:
        try:
            estado.activar(tipo, await _leer_cuerpo(request))
        except FallaDesconocidaError:
            return _desconocida(tipo)
        except ParametrosInvalidosError as error:
            return _error(400, "parametros_invalidos", str(error))
        return JSONResponse(estado.describir(tipo))

    @rutas.delete("/caos/{tipo}")
    def apagar(tipo: str) -> JSONResponse:
        try:
            estado.apagar(tipo)
        except FallaDesconocidaError:
            return _desconocida(tipo)
        return JSONResponse(estado.describir(tipo))

    @rutas.delete("/caos")
    def apagar_todo() -> JSONResponse:
        estado.apagar_todo()
        return todas()

    return rutas


def _desconocida(tipo: str) -> JSONResponse:
    return _error(404, "falla_desconocida", f"catalogo no tiene una falla llamada {tipo}")
