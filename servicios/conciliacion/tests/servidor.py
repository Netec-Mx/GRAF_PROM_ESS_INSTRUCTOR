"""Servidor HTTP de mentira para las pruebas, hecho con wsgiref de la librería estándar."""

import json
import threading
from collections.abc import Iterable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import override
from wsgiref.simple_server import WSGIRequestHandler, make_server
from wsgiref.types import StartResponse, WSGIEnvironment

_FRASES = {200: "OK", 302: "Found", 404: "Not Found", 500: "Internal Server Error"}


class _SinLogs(WSGIRequestHandler):
    @override
    def log_message(self, format: str, *args: object) -> None:
        return


@dataclass
class Servidor:
    """Responde lo que la prueba le deje por ruta, y recuerda cada petición que recibe."""

    url: str = ""
    respuestas: dict[str, tuple[int, bytes]] = field(default_factory=dict)
    # Método, ruta con su query y cuerpo de cada petición.
    peticiones: list[tuple[str, str, str]] = field(default_factory=list)

    def responder(self, ruta: str, cuerpo: object, codigo: int = 200) -> None:
        crudo = cuerpo if isinstance(cuerpo, bytes) else json.dumps(cuerpo).encode()
        self.respuestas[ruta] = (codigo, crudo)

    def atender(self, entorno: WSGIEnvironment, iniciar: StartResponse) -> Iterable[bytes]:
        ruta = str(entorno["PATH_INFO"])
        if entorno.get("QUERY_STRING"):
            ruta += "?" + str(entorno["QUERY_STRING"])
        largo = int(entorno.get("CONTENT_LENGTH") or 0)
        cuerpo = entorno["wsgi.input"].read(largo).decode() if largo else ""
        self.peticiones.append((str(entorno["REQUEST_METHOD"]), ruta, cuerpo))

        codigo, respuesta = self.respuestas.get(ruta, (200, b"{}"))
        cabeceras = [("Content-Type", "application/json"), ("Content-Length", str(len(respuesta)))]
        if codigo == 302:
            cabeceras.append(("Location", "/otra"))
        iniciar(f"{codigo} {_FRASES[codigo]}", cabeceras)
        return [respuesta]


@contextmanager
def levantar() -> Iterator[Servidor]:
    servidor = Servidor()
    http = make_server("127.0.0.1", 0, servidor.atender, handler_class=_SinLogs)
    servidor.url = f"http://127.0.0.1:{http.server_port}"
    hilo = threading.Thread(target=http.serve_forever, daemon=True)
    hilo.start()
    try:
        yield servidor
    finally:
        http.shutdown()
        http.server_close()
