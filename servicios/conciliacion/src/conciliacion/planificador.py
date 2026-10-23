"""Planificador: python -m conciliacion.planificador.

Lanza una corrida (python -m conciliacion) como proceso nuevo cada intervalo y espera a que
termine. Cada corrida nace, trabaja, empuja sus métricas y muere: por eso el job no se puede
raspar y usa el Pushgateway.

Con la señal SIGUSR1 lanza una corrida en el momento, sin esperar al intervalo. Es lo que usa
bin/conciliar.sh. Como la corrida sale de este mismo contenedor, sus logs llegan a Loki.

También vigila la bandera de caos: cada cambio queda en el log y actualiza chaos_active en el
Pushgateway. Al arrancar borra la bandera, así un reinicio apaga el caos.
"""

import logging
import os
import signal
import subprocess
import sys
import time
from collections.abc import Callable
from types import FrameType

from conciliacion.__main__ import ORIGEN_MANUAL, ORIGEN_PLANIFICADO, VARIABLE_DE_ORIGEN
from conciliacion.aplicacion import PublicacionFallidaError
from conciliacion.configuracion import Configuracion, leer
from conciliacion.infraestructura.caos import FALLAR, BanderaDeCaos
from conciliacion.infraestructura.publicador_pushgateway import PublicadorPushgateway
from conciliacion.latido import tocar
from conciliacion.registro import configurar_logs

logger = logging.getLogger("conciliacion.planificador")

COMANDO = (sys.executable, "-m", "conciliacion")

# Cada cuánto se toca el latido mientras se espera. Así el latido también avanza durante una
# espera larga y solo se detiene si el planificador se cuelga.
PASO_DE_LATIDO = 5.0

# Cada cuánto el bucle revisa si llegó una señal. Es lo máximo que tarda en arrancar una
# corrida manual.
PASO_DE_SONDEO = 0.25

# Cada cuánto se revisa la bandera de caos.
PASO_DE_CAOS = 1.0

# Cada cuánto se reintenta publicar chaos_active si el Pushgateway no lo aceptó.
REINTENTO_DE_CAOS = 30.0


def lanzar_corrida(origen: str, timeout: float) -> int:
    """Corre una conciliación como proceso nuevo y devuelve su código de salida."""
    entorno = {**os.environ, VARIABLE_DE_ORIGEN: origen}
    try:
        return subprocess.run(COMANDO, check=False, timeout=timeout, env=entorno).returncode
    except subprocess.TimeoutExpired:
        logger.error("la corrida no termino a tiempo y se cancelo", extra={"trigger": origen})
        return 1


class VigiaDeCaos:
    """Sigue la bandera de caos: anota cada cambio en el log y publica chaos_active.

    publicar recibe si la falla está encendida y lanza PublicacionFallidaError si no puede.
    Si la publicación falla, avisa una vez y reintenta cada REINTENTO_DE_CAOS segundos: con el
    Pushgateway colgado, cada intento puede tardar lo que dure el timeout, y el planificador
    no debe quedarse sin atender las corridas por eso.
    """

    def __init__(
        self,
        bandera: BanderaDeCaos,
        publicar: Callable[[bool], None],
        cronometro: Callable[[], float] = time.monotonic,
    ) -> None:
        self._bandera = bandera
        self._publicar = publicar
        self._cronometro = cronometro
        self._activa = False
        self._restante: int | None = None
        self._publicada: bool | None = None
        self._proximo_intento: float | None = None

    def revisar(self) -> None:
        restante = self._bandera.restante()
        activa = self._bandera.activa()
        if activa and not self._activa:
            logger.warning("caos activado", extra={"chaos_type": FALLAR})
        elif self._activa and not activa:
            # Si le quedaba menos de un paso de vida, se apagó sola.
            vencio = self._restante is not None and self._restante <= PASO_DE_CAOS
            logger.warning(
                "caos vencido" if vencio else "caos apagado", extra={"chaos_type": FALLAR}
            )
        self._activa = activa
        self._restante = restante
        if self._publicada != activa:
            self._intentar_publicar(activa)

    def _intentar_publicar(self, activa: bool) -> None:
        ahora = self._cronometro()
        if self._proximo_intento is not None and ahora < self._proximo_intento:
            return
        try:
            self._publicar(activa)
        except PublicacionFallidaError as error:
            if self._proximo_intento is None:
                logger.warning("no se pudo publicar chaos_active", extra={"error": str(error)})
            self._proximo_intento = ahora + REINTENTO_DE_CAOS
        else:
            self._publicada = activa
            self._proximo_intento = None


class Planificador:
    """Decide cuándo corre la conciliación.

    - Primera corrida tras primera_espera, y después una por intervalo.
    - Una señal de corrida manual adelanta una corrida. No mueve la hora de la siguiente
      planificada.
    - Si la señal llega con una corrida en curso, se ignora y queda en el log.

    Los manejadores de señal solo cambian una variable. No escriben en el log ni tocan
    candados: una señal interrumpe al hilo principal en cualquier punto, también cuando ya
    tiene tomado un candado, y pedirlo otra vez desde el manejador lo dejaría colgado.
    El bucle principal mira esas variables cada PASO_DE_SONDEO.
    """

    def __init__(
        self,
        config: Configuracion,
        lanzar: Callable[[str, float], int] = lanzar_corrida,
        latir: Callable[[str], None] = tocar,
        cronometro: Callable[[], float] = time.monotonic,
        dormir: Callable[[float], None] = time.sleep,
        revisar_caos: Callable[[], None] = lambda: None,
    ) -> None:
        self._config = config
        self._lanzar = lanzar
        self._latir = latir
        self._cronometro = cronometro
        self._dormir = dormir
        self._revisar_caos = revisar_caos
        self._detener = False
        self._senal_de_corrida = False

    def pedir_detener(self) -> None:
        """Para llamar desde un manejador de señal: solo cambia una variable."""
        self._detener = True

    def pedir_corrida_manual(self) -> None:
        """Para llamar desde un manejador de señal: solo cambia una variable."""
        self._senal_de_corrida = True

    def planificar(self) -> None:
        """Corre hasta que pidan detener."""
        proxima = self._cronometro() + self._config.primera_espera
        while not self._detener:
            self._esperar_hasta(proxima)
            if self._detener:
                return
            if self._senal_de_corrida:
                self._senal_de_corrida = False
                logger.info("corrida manual solicitada")
                self._correr(ORIGEN_MANUAL)
            else:
                self._correr(ORIGEN_PLANIFICADO)
                proxima = self._cronometro() + self._config.intervalo

    def _esperar_hasta(self, limite: float) -> None:
        """Espera tocando el latido, hasta el límite o hasta que llegue una señal."""
        ultimo_latido: float | None = None
        ultimo_caos: float | None = None
        while not self._detener and not self._senal_de_corrida:
            ahora = self._cronometro()
            if ultimo_caos is None or ahora - ultimo_caos >= PASO_DE_CAOS:
                self._revisar_caos()
                ultimo_caos = ahora
            if ultimo_latido is None or ahora - ultimo_latido >= PASO_DE_LATIDO:
                self._latir(self._config.archivo_de_latido)
                ultimo_latido = ahora
            restante = limite - ahora
            if restante <= 0:
                return
            self._dormir(min(PASO_DE_SONDEO, restante))

    def _correr(self, origen: str) -> None:
        codigo = self._lanzar(origen, self._config.intervalo)
        self._latir(self._config.archivo_de_latido)
        if self._senal_de_corrida:
            # Llegó mientras la corrida estaba en marcha.
            self._senal_de_corrida = False
            logger.warning("corrida manual ignorada: ya habia una corrida en curso")
        if codigo != 0:
            logger.warning(
                "la corrida termino con error", extra={"exit_code": codigo, "trigger": origen}
            )


def ejecutar() -> int:
    configurar_logs()
    try:
        config = leer()
    except ValueError as error:
        logger.error("configuracion invalida", extra={"error": str(error)})
        return 1

    # Un reinicio apaga el caos: la bandera de antes no vale.
    bandera = BanderaDeCaos(config.bandera_de_caos, habilitada=config.caos_habilitado)
    bandera.apagar()
    publicador = PublicadorPushgateway(config.pushgateway_url, config.timeout)
    vigia = VigiaDeCaos(bandera, lambda activa: publicador.publicar_caos(activo=activa))
    planificador = Planificador(config, revisar_caos=vigia.revisar)

    def al_pedir_detener(_numero: int, _marco: FrameType | None) -> None:
        planificador.pedir_detener()

    def al_pedir_corrida(_numero: int, _marco: FrameType | None) -> None:
        planificador.pedir_corrida_manual()

    signal.signal(signal.SIGTERM, al_pedir_detener)
    signal.signal(signal.SIGINT, al_pedir_detener)
    signal.signal(signal.SIGUSR1, al_pedir_corrida)

    logger.info(
        "planificador iniciado: primera corrida en %.0f s, despues cada %.0f s",
        config.primera_espera,
        config.intervalo,
    )
    planificador.planificar()
    logger.info("planificador detenido")
    return 0


if __name__ == "__main__":
    sys.exit(ejecutar())
