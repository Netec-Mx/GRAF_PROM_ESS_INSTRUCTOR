"""Middleware ASGI que registra las métricas HTTP."""

import time
from collections.abc import Callable

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from catalogo import metricas
from catalogo.api.comun import metodo_acotado, plantilla_de_ruta, ruta_excluida, ruta_real

_ERROR_INTERNO = 500


class MiddlewareDeMetricas:
    """con_ruta_real dice, en cada petición, si la etiqueta route lleva la ruta real en vez
    de la plantilla. Solo lo enciende la falla cardinalidad."""

    def __init__(self, app: ASGIApp, con_ruta_real: Callable[[], bool] = lambda: False) -> None:
        self.app = app
        self._con_ruta_real = con_ruta_real

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

        metricas.EN_CURSO.inc()
        inicio = time.perf_counter()
        try:
            await self.app(scope, receive, enviar)
        finally:
            duracion = time.perf_counter() - inicio
            metricas.EN_CURSO.dec()
            metodo = metodo_acotado(scope)
            ruta = ruta_real(scope) if self._con_ruta_real() else plantilla_de_ruta(scope)
            metricas.PETICIONES.labels(method=metodo, route=ruta, status=str(estado)).inc()
            metricas.DURACION.labels(method=metodo, route=ruta).observe(duracion)
