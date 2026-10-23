"""Rutas HTTP del catálogo."""

from collections.abc import Sequence
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request, Response
from prometheus_client import REGISTRY
from prometheus_client.exposition import choose_encoder
from pydantic import BaseModel

from catalogo import metricas
from catalogo.api.caos import Inyector
from catalogo.aplicacion import (
    BuscarProductos,
    ListarProductos,
    ObtenerProducto,
    RepositorioDeProductos,
)
from catalogo.dominio import Producto


class ProductoSalida(BaseModel):
    sku: str
    nombre: str
    categoria: str
    # Texto con dos decimales exactos ("89.00"): un número JSON perdería los ceros.
    precio_mxn: str
    stock: int

    @classmethod
    def desde(cls, producto: Producto) -> ProductoSalida:
        return cls(
            sku=producto.sku,
            nombre=producto.nombre,
            categoria=producto.categoria,
            precio_mxn=f"{producto.precio_mxn:.2f}",
            stock=producto.stock,
        )


class ListaDeProductos(BaseModel):
    total: int
    productos: list[ProductoSalida]

    @classmethod
    def desde(cls, productos: Sequence[Producto]) -> ListaDeProductos:
        return cls(total=len(productos), productos=[ProductoSalida.desde(p) for p in productos])


class Salud(BaseModel):
    estado: str


class ErrorSalida(BaseModel):
    error: str
    mensaje: str


# Plantillas de las rutas de negocio. Son las únicas que el caos puede afectar.
RUTAS_DE_NEGOCIO = frozenset({"/productos", "/productos/buscar", "/productos/{sku}"})


async def _sin_caos(_: Request) -> None:
    """Inyector que no hace nada."""


def crear_rutas(repositorio: RepositorioDeProductos, inyectar: Inyector = _sin_caos) -> APIRouter:
    """Arma las rutas. inyectar corre antes de cada ruta de negocio; es por donde entra el caos.

    /salud y /metrics van en un enrutador aparte, sin inyector: el caos nunca las toca.
    """
    listar = ListarProductos(repositorio)
    obtener = ObtenerProducto(repositorio)
    buscar = BuscarProductos(repositorio)

    rutas = APIRouter(dependencies=[Depends(inyectar)])
    plataforma = APIRouter()

    @rutas.get("/productos")
    def listar_productos(categoria: str | None = None) -> ListaDeProductos:
        return ListaDeProductos.desde(listar.ejecutar(categoria))

    # Va antes de /productos/{sku}: si no, "buscar" se tomaría como un sku.
    @rutas.get("/productos/buscar")
    def buscar_productos(q: Annotated[str, Query(min_length=1)]) -> ListaDeProductos:
        encontrados = buscar.ejecutar(q)
        if not encontrados:
            metricas.BUSQUEDAS_SIN_RESULTADOS.inc()
        return ListaDeProductos.desde(encontrados)

    @rutas.get("/productos/{sku}", responses={404: {"model": ErrorSalida}})
    def obtener_producto(sku: str) -> ProductoSalida:
        return ProductoSalida.desde(obtener.ejecutar(sku))

    @plataforma.get("/salud")
    def salud() -> Salud:
        return Salud(estado="ok")

    @plataforma.get("/metrics", include_in_schema=False)
    def exponer_metricas(request: Request) -> Response:
        codificar, tipo_de_contenido = choose_encoder(request.headers.get("accept", ""))
        return Response(content=codificar(REGISTRY), media_type=tipo_de_contenido)

    todas = APIRouter()
    todas.include_router(rutas)
    todas.include_router(plataforma)
    return todas
