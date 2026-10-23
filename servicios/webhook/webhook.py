"""Receptor de webhooks del laboratorio.

Recibe las notificaciones que mandan Alertmanager y Grafana y escribe cada una como una
línea JSON por stdout. Alloy recoge esa salida y la deja en Loki, así que las notificaciones
se ven en Grafana sin depender de Slack ni de Teams.

Solo usa la biblioteca estándar. No guarda nada: lo recibido vive en los logs.
"""

import json
import os
import sys
from collections.abc import Callable, Iterable
from datetime import UTC, datetime
from typing import override
from wsgiref.simple_server import WSGIRequestHandler, make_server

PUERTO = int(os.environ.get("PUERTO", "8080"))
# Cuerpo máximo que se acepta. Una notificación de Alertmanager con muchas alertas pesa
# unas decenas de KB.
CUERPO_MAXIMO = 1024 * 1024

type Iniciar = Callable[[str, list[tuple[str, str]]], object]


def escribir(registro: dict[str, object]) -> None:
    """Una línea JSON por stdout, con la hora en UTC."""
    linea = {"time": datetime.now(UTC).isoformat(timespec="milliseconds"), **registro}
    sys.stdout.write(json.dumps(linea, ensure_ascii=False, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def resumen(cuerpo: object) -> dict[str, object]:
    """Campos de primer nivel que traen Alertmanager y Grafana, para filtrar en Loki."""
    if not isinstance(cuerpo, dict):
        return {}
    alertas = cuerpo.get("alerts")
    nombres: list[str] = []
    if isinstance(alertas, list):
        for alerta in alertas:
            etiquetas = alerta.get("labels") if isinstance(alerta, dict) else None
            nombre = etiquetas.get("alertname") if isinstance(etiquetas, dict) else None
            if isinstance(nombre, str) and nombre not in nombres:
                nombres.append(nombre)
    return {
        "receiver": cuerpo.get("receiver"),
        "status": cuerpo.get("status"),
        "alertas": len(alertas) if isinstance(alertas, list) else 0,
        "alertnames": ",".join(nombres),
    }


def responder(iniciar: Iniciar, estado: str, cuerpo: dict[str, object]) -> list[bytes]:
    datos = json.dumps(cuerpo).encode()
    iniciar(estado, [("Content-Type", "application/json"), ("Content-Length", str(len(datos)))])
    return [datos]


def aplicacion(entorno: dict[str, object], iniciar: Iniciar) -> Iterable[bytes]:
    """GET /salud responde ok. Cualquier POST se toma como una notificación."""
    metodo = entorno.get("REQUEST_METHOD")
    ruta = str(entorno.get("PATH_INFO") or "/")
    if metodo == "GET" and ruta == "/salud":
        return responder(iniciar, "200 OK", {"estado": "ok"})
    if metodo != "POST":
        return responder(iniciar, "404 Not Found", {"error": "no_existe"})

    largo = int(str(entorno.get("CONTENT_LENGTH") or 0))
    if largo > CUERPO_MAXIMO:
        return responder(iniciar, "413 Payload Too Large", {"error": "cuerpo_demasiado_grande"})
    entrada = entorno["wsgi.input"]
    crudo: bytes = entrada.read(largo) if hasattr(entrada, "read") else b""
    try:
        cuerpo: object = json.loads(crudo or b"null")
    except ValueError:
        cuerpo = crudo.decode("utf-8", errors="replace")
    escribir(
        {
            "level": "info",
            "msg": "notificacion recibida",
            "ruta": ruta,
            **resumen(cuerpo),
            "notificacion": cuerpo,
        }
    )
    return responder(iniciar, "200 OK", {"recibida": True})


class SinRegistroDeAcceso(WSGIRequestHandler):
    """Sin el log de acceso por stderr: cada notificación ya deja su línea JSON."""

    @override
    def log_message(self, format: str, *args: object) -> None:
        pass


def main() -> None:
    servidor = make_server("0.0.0.0", PUERTO, aplicacion, handler_class=SinRegistroDeAcceso)
    escribir({"level": "info", "msg": f"escuchando en el puerto {PUERTO}"})
    servidor.serve_forever()


if __name__ == "__main__":
    main()
