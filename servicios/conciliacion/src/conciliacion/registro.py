"""Logs en JSON por stdout, una línea por evento."""

import json
import logging
import sys
from datetime import UTC, datetime
from typing import override

SERVICIO = "conciliacion"

# Campos que una corrida agrega a sus líneas de inicio y de fin.
_CAMPOS_DE_CORRIDA = (
    "run_id",
    "trigger",
    "result",
    "duration_ms",
    "orders_checked",
    "orders_unpaid",
    "amount_mismatches",
    "approved_amount_mxn",
    "exit_code",
    "error",
    # Campo de las líneas que deja cada cambio de caos.
    "chaos_type",
)


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
        for campo in _CAMPOS_DE_CORRIDA:
            if hasattr(record, campo):
                linea[campo] = getattr(record, campo)
        linea["msg"] = record.getMessage()
        if record.exc_info:
            linea["exception"] = self.formatException(record.exc_info)
        return json.dumps(linea, ensure_ascii=False)


def configurar_logs(nivel: int = logging.INFO) -> None:
    """Deja un único manejador en la raíz: JSON a stdout, sin búfer entre líneas."""
    manejador = logging.StreamHandler(sys.stdout)
    manejador.setFormatter(FormateadorJson())
    raiz = logging.getLogger()
    raiz.handlers = [manejador]
    raiz.setLevel(nivel)
