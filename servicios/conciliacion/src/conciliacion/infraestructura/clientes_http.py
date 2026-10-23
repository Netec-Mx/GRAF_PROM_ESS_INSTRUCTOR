"""Clientes HTTP de pedidos y pagos, hechos con la librería estándar."""

import http.client
import json
import re
import urllib.error
import urllib.request
from decimal import Decimal
from typing import cast, override
from urllib.parse import urlsplit

from conciliacion.aplicacion import DependenciaNoDisponibleError
from conciliacion.dominio import Pago, Pedido, instante

# Tope de lo que se lee de una respuesta. Pedidos y pagos conservan hasta 1000 elementos cada
# uno; una lista completa ocupa unos cientos de KB.
MAX_BYTES = 8 * 1024 * 1024

_MONTO = re.compile(r"\d{1,12}\.\d{2}")


class _SinRedirecciones(urllib.request.HTTPRedirectHandler):
    """pedidos y pagos no redirigen. Si lo hicieran, no se sigue a ciegas."""

    @override
    def redirect_request(self, *_args: object, **_kwargs: object) -> None:
        return None


class _ClienteJson:
    """GET de un JSON contra un servicio interno, con timeout y tope de tamaño."""

    def __init__(self, nombre: str, url_base: str, timeout: float) -> None:
        partes = urlsplit(url_base)
        if partes.scheme not in ("http", "https") or not partes.netloc:
            raise ValueError(f"URL de {nombre} inválida: {url_base!r}")
        self._nombre = nombre
        self._url_base = url_base.rstrip("/")
        self._timeout = timeout
        self._abridor = urllib.request.build_opener(_SinRedirecciones)

    def obtener(self, ruta: str) -> dict[str, object]:
        peticion = urllib.request.Request(
            self._url_base + ruta, headers={"Accept": "application/json"}, method="GET"
        )
        try:
            with self._abridor.open(peticion, timeout=self._timeout) as respuesta:
                cuerpo = respuesta.read(MAX_BYTES + 1)
        except urllib.error.HTTPError as error:
            raise DependenciaNoDisponibleError(f"{self._nombre} respondió {error.code}") from error
        except (OSError, ValueError, http.client.HTTPException) as error:
            # Sin conexión, nombre que no resuelve, timeout, respuesta cortada, o algo que no
            # es HTTP válido (HTTPException no hereda de OSError).
            raise DependenciaNoDisponibleError(
                f"{self._nombre} no respondió bien: {type(error).__name__}: {error}"
            ) from error

        if len(cuerpo) > MAX_BYTES:
            raise self.invalida("respuesta demasiado grande")
        try:
            datos = json.loads(cuerpo)
        except ValueError as error:
            raise self.invalida("no es JSON") from error
        if not isinstance(datos, dict):
            raise self.invalida("no es un objeto JSON")
        return cast("dict[str, object]", datos)

    def invalida(self, motivo: str) -> DependenciaNoDisponibleError:
        return DependenciaNoDisponibleError(f"respuesta inválida de {self._nombre}: {motivo}")

    def lista(self, datos: dict[str, object], campo: str) -> list[dict[str, object]]:
        """Devuelve la lista de datos[campo], y exige que total coincida con su largo.

        Si total dice 5 y la lista trae 0, la respuesta está truncada o mal armada. Aceptarla
        como "no hay nada" daría una corrida exitosa con datos falsos.
        """
        elementos = datos.get(campo)
        if not isinstance(elementos, list) or not all(isinstance(e, dict) for e in elementos):
            raise self.invalida(f"falta la lista {campo}")
        total = datos.get("total")
        # bool hereda de int: True no es un total.
        if not isinstance(total, int) or isinstance(total, bool):
            raise self.invalida("total no es un número entero")
        if total != len(elementos):
            raise self.invalida(f"total dice {total} y la lista {campo} trae {len(elementos)}")
        return cast("list[dict[str, object]]", elementos)

    def texto(self, elemento: dict[str, object], campo: str) -> str:
        valor = elemento.get(campo)
        if not isinstance(valor, str) or not valor:
            raise self.invalida(f"falta el texto {campo}")
        return valor

    def fecha(self, elemento: dict[str, object], campo: str) -> str:
        """Lee una fecha y exige que se pueda ubicar en el tiempo: con ella se arma la ventana."""
        valor = self.texto(elemento, campo)
        try:
            instante(valor)
        except ValueError:
            raise self.invalida(f"{campo} no es una fecha con zona horaria") from None
        return valor

    def monto(self, elemento: dict[str, object], campo: str) -> Decimal:
        """Lee un monto que viaja como texto con dos decimales. Nunca pasa por float."""
        valor = self.texto(elemento, campo)
        if not _MONTO.fullmatch(valor):
            raise self.invalida(f"{campo} no es un monto con dos decimales")
        return Decimal(valor)


class ClientePedidos:
    """Implementa PedidosPort contra GET /pedidos?estado=confirmado."""

    def __init__(self, url_base: str, timeout: float) -> None:
        self._cliente = _ClienteJson("pedidos", url_base, timeout)

    def confirmados(self) -> list[Pedido]:
        datos = self._cliente.obtener("/pedidos?estado=confirmado")
        return [
            Pedido(
                id=self._cliente.texto(e, "id"),
                creado_en=self._cliente.fecha(e, "creado_en"),
                total=self._cliente.monto(e, "total_mxn"),
            )
            for e in self._cliente.lista(datos, "pedidos")
        ]


class ClientePagos:
    """Implementa PagosPort contra GET /pagos."""

    def __init__(self, url_base: str, timeout: float) -> None:
        self._cliente = _ClienteJson("pagos", url_base, timeout)

    def todos(self) -> list[Pago]:
        datos = self._cliente.obtener("/pagos")
        return [
            Pago(
                id=self._cliente.texto(e, "id"),
                pedido_id=self._cliente.texto(e, "pedido_id"),
                pedido_creado_en=self._cliente.fecha(e, "pedido_creado_en"),
                monto=self._cliente.monto(e, "monto_mxn"),
                estado=self._cliente.texto(e, "estado"),
            )
            for e in self._cliente.lista(datos, "pagos")
        ]
