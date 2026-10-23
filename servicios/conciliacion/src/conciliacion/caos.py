"""Control del caos de conciliacion: python -m conciliacion.caos.

    python -m conciliacion.caos estado
    python -m conciliacion.caos fallar [duracion_s=N]
    python -m conciliacion.caos fallar off
    python -m conciliacion.caos apagar

Lo usa bin/caos.sh con docker exec. Enciende y apaga la bandera de la falla fallar, e imprime
el estado en JSON, con la misma forma que GET /caos en los otros servicios.

Sale con 0 si todo fue bien, con 2 si los argumentos no valen y con 3 si el caos está
deshabilitado porque el contenedor arrancó con CAOS_TOKEN vacío.

El cambio queda en el log del planificador, que es el que llega a Loki, y es él quien
actualiza chaos_active en el Pushgateway.
"""

import json
import sys
from collections.abc import Sequence

from conciliacion.configuracion import leer
from conciliacion.infraestructura.caos import FALLAR, BanderaDeCaos, CaosDeshabilitadoError

SALIDA_USO = 2
SALIDA_DESHABILITADO = 3

USO = "uso: python -m conciliacion.caos estado | apagar | fallar [duracion_s=N] | fallar off"


class UsoInvalidoError(Exception):
    """Los argumentos no cumplen el contrato."""


def describir(bandera: BanderaDeCaos) -> dict[str, object]:
    falla = {
        "tipo": FALLAR,
        "activa": bandera.activa(),
        "restante_s": bandera.restante(),
        "parametros": {},
    }
    return {"servicio": "conciliacion", "fallas": [falla]}


def _duracion(parametros: Sequence[str]) -> int | None:
    """Lee el único parámetro que admite fallar: duracion_s=N."""
    duracion: int | None = None
    for parametro in parametros:
        nombre, hay_valor, valor = parametro.partition("=")
        if nombre != "duracion_s" or not hay_valor:
            raise UsoInvalidoError(f"fallar no admite {parametro}. Admite: duracion_s")
        if not (valor.isascii() and valor.isdigit()):
            raise UsoInvalidoError("duracion_s debe ser un entero entre 1 y 86400")
        duracion = int(valor)
    return duracion


def aplicar(argumentos: Sequence[str], bandera: BanderaDeCaos) -> None:
    """Hace lo que piden los argumentos. Lanza UsoInvalidoError si no se entienden."""
    if not argumentos:
        raise UsoInvalidoError(USO)
    orden, *parametros = argumentos
    if orden in {"estado", "apagar"}:
        if parametros:
            raise UsoInvalidoError(USO)
        if orden == "apagar":
            bandera.apagar()
        return
    if orden != FALLAR:
        raise UsoInvalidoError(f"conciliacion no tiene una falla llamada {orden}")
    if parametros == ["off"]:
        bandera.apagar()
        return
    try:
        bandera.encender(_duracion(parametros))
    except ValueError as error:
        raise UsoInvalidoError(str(error)) from None


def ejecutar(argumentos: Sequence[str]) -> int:
    try:
        config = leer()
        bandera = BanderaDeCaos(config.bandera_de_caos, habilitada=config.caos_habilitado)
        aplicar(argumentos, bandera)
        if not bandera.habilitada:
            raise CaosDeshabilitadoError("el contenedor arrancó con CAOS_TOKEN vacío")
    except (UsoInvalidoError, ValueError) as error:
        _avisar("parametros_invalidos", str(error))
        return SALIDA_USO
    except CaosDeshabilitadoError as error:
        _avisar("caos_deshabilitado", str(error))
        return SALIDA_DESHABILITADO
    print(json.dumps(describir(bandera), separators=(",", ":")))
    return 0


def _avisar(codigo: str, mensaje: str) -> None:
    cuerpo = {"error": codigo, "mensaje": mensaje}
    print(json.dumps(cuerpo, ensure_ascii=False, separators=(",", ":")), file=sys.stderr)


if __name__ == "__main__":
    sys.exit(ejecutar(sys.argv[1:]))
