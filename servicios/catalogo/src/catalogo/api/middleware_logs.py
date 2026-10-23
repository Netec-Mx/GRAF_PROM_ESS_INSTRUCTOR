"""Middleware ASGI que escribe una línea de log por petición."""

import logging
import time

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from catalogo.api.comun import metodo_acotado, plantilla_de_ruta, ruta_excluida

_log = logging.getLogger("catalogo.peticiones")

_ERROR_INTERNO = 500
_ERROR_DE_CLIENTE = 400


class MiddlewareDeLogs:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or ruta_excluida(scope["path"]):
            await self.app(scope, receive, send)
            return

        estado = _ERROR_INTERNO

        async def enviar(mensaje: Message) -> None:
            nonlocal estado
            if mensaje["type"] == "http.response.start":
                estado = int(mensaje["status"])
            await send(mensaje)

        inicio = time.perf_counter()
        try:
            await self.app(scope, receive, enviar)
        finally:
            duracion_ms = round((time.perf_counter() - inicio) * 1000, 3)
            _log.log(
                _nivel(estado),
                "peticion atendida",
                extra={
                    "method": metodo_acotado(scope),
                    "route": plantilla_de_ruta(scope),
                    "status": estado,
                    "duration_ms": duracion_ms,
                },
            )


def _nivel(estado: int) -> int:
    if estado >= _ERROR_INTERNO:
        return logging.ERROR
    if estado >= _ERROR_DE_CLIENTE:
        return logging.WARNING
    return logging.INFO
