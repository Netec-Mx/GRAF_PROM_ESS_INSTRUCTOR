"""Logs en JSON por stdout, una línea por evento."""

import json
import logging
import sys
from datetime import UTC, datetime
from typing import override

SERVICIO = "catalogo"

# Campos que el middleware de logs agrega a cada petición.
_CAMPOS_DE_PETICION = ("method", "route", "status", "duration_ms")

# Campos de las líneas que deja cada cambio de caos.
_CAMPOS_DE_CAOS = ("chaos_type", "params", "duration_s")


class FormateadorJson(logging.Formatter):
    @override
    def format(self, record: logging.LogRecord) -> str:
        linea: dict[str, object] = {
            "timestamp": datetime.fromtimestamp(record.created, tz=UTC).isoformat(
                timespec="milliseconds"
            ),
            "level": record.levelname.lower(),
            "service": SERVICIO,
        }
        for campo in (*_CAMPOS_DE_PETICION, *_CAMPOS_DE_CAOS):
            if hasattr(record, campo):
                linea[campo] = getattr(record, campo)
        linea["msg"] = record.getMessage()
        if record.exc_info:
            linea["exception"] = self.formatException(record.exc_info)
        return json.dumps(linea, ensure_ascii=False)


def configurar_logs(nivel: int = logging.INFO) -> None:
    """Deja un único manejador en la raíz: JSON a stdout. uvicorn hereda de él."""
    manejador = logging.StreamHandler(sys.stdout)
    manejador.setFormatter(FormateadorJson())
    raiz = logging.getLogger()
    raiz.handlers = [manejador]
    raiz.setLevel(nivel)
