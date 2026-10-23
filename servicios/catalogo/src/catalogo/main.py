"""Armado de la aplicación."""

import asyncio
import os
from collections import Counter
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager, suppress
from pathlib import Path

import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from catalogo import metricas
from catalogo.api.caos import (
    ErrorInyectadoError,
    Inyector,
    RechazoDeCaosError,
    crear_inyector,
    crear_rutas_de_caos,
    respuesta_de_error_inyectado,
)
from catalogo.api.middleware_logs import MiddlewareDeLogs
from catalogo.api.middleware_metricas import MiddlewareDeMetricas
from catalogo.api.rutas import RUTAS_DE_NEGOCIO, ErrorSalida, crear_rutas
from catalogo.aplicacion import RepositorioDeProductos
from catalogo.dominio import ProductoNoEncontradoError
from catalogo.infraestructura import RepositorioEnMemoria
from catalogo.infraestructura.caos import CARDINALIDAD, TIPOS, EstadoDeCaos, Fuga, Motor
from catalogo.registro import configurar_logs

_DATOS_POR_DEFECTO = Path(__file__).resolve().parents[2] / "datos" / "productos.json"


def ruta_de_datos() -> Path:
    return Path(os.environ.get("CATALOGO_DATOS", str(_DATOS_POR_DEFECTO)))


def publicar_agotados(repositorio: RepositorioDeProductos) -> None:
    """Fija el gauge de agotados por categoría. Los datos no cambian mientras corre."""
    productos = repositorio.todos()
    agotados = Counter(p.categoria for p in productos if p.agotado)
    for categoria in {p.categoria for p in productos}:
        metricas.AGOTADOS.labels(category=categoria).set(agotados[categoria])


def publicar_caos(estado: EstadoDeCaos) -> None:
    """Deja chaos_active con una serie por falla, que lee el estado en cada scrape."""

    def lector(tipo: str) -> Callable[[], float]:
        return lambda: 0 if estado.vigente(tipo) is None else 1

    for tipo in TIPOS:
        metricas.CAOS_ACTIVO.labels(type=tipo).set_function(lector(tipo))


# Cada cuánto el caos revisa si venció una falla y hace crecer la fuga de memoria.
PASO_DEL_CAOS = 1.0


def crear_app(
    repositorio: RepositorioDeProductos | None = None,
    estado_de_caos: EstadoDeCaos | None = None,
    token_de_caos: str | None = None,
    inyectar: Inyector | None = None,
) -> FastAPI:
    """Arma la app. Sin token_de_caos se usa CAOS_TOKEN; si queda vacío, /caos no existe.

    inyectar reemplaza al inyector de fallas de las rutas de negocio; lo usan las pruebas.
    """
    repositorio = repositorio or RepositorioEnMemoria.desde_json(ruta_de_datos())
    publicar_agotados(repositorio)

    caos = estado_de_caos or EstadoDeCaos(RUTAS_DE_NEGOCIO)
    publicar_caos(caos)
    motor = Motor(caos, Fuga())
    token = os.environ.get("CAOS_TOKEN", "") if token_de_caos is None else token_de_caos

    @asynccontextmanager
    async def vida(_: FastAPI) -> AsyncIterator[None]:
        async def latir() -> None:
            while True:
                await asyncio.sleep(PASO_DEL_CAOS)
                motor.avanzar(PASO_DEL_CAOS)

        tarea = asyncio.create_task(latir())
        try:
            yield
        finally:
            tarea.cancel()
            with suppress(asyncio.CancelledError):
                await tarea

    app = FastAPI(
        title="catalogo",
        version="0.1.0",
        description="Catálogo de Tianguis Digital.",
        lifespan=vida,
    )
    app.include_router(crear_rutas(repositorio, inyectar or crear_inyector(caos)))
    if token:
        app.include_router(crear_rutas_de_caos(caos, token))

    @app.exception_handler(ErrorInyectadoError)
    def error_inyectado(_: Request, error: ErrorInyectadoError) -> JSONResponse:
        return respuesta_de_error_inyectado(error)

    @app.exception_handler(RechazoDeCaosError)
    def rechazo_de_caos(_: Request, error: RechazoDeCaosError) -> JSONResponse:
        return error.respuesta

    @app.exception_handler(ProductoNoEncontradoError)
    def producto_no_encontrado(_: Request, error: ProductoNoEncontradoError) -> JSONResponse:
        cuerpo = ErrorSalida(error="producto_no_encontrado", mensaje=str(error))
        return JSONResponse(status_code=404, content=cuerpo.model_dump())

    # Los middlewares envuelven a toda la app. El último agregado es el más externo.
    # Un middleware nuevo se suma aquí con una línea.
    app.add_middleware(MiddlewareDeLogs)
    app.add_middleware(
        MiddlewareDeMetricas, con_ruta_real=lambda: caos.vigente(CARDINALIDAD) is not None
    )
    return app


def ejecutar() -> None:
    configurar_logs()
    uvicorn.run(
        crear_app(),
        host=os.environ.get("CATALOGO_HOST", "0.0.0.0"),
        port=int(os.environ.get("CATALOGO_PUERTO", "8000")),
        log_config=None,
        access_log=False,
    )
