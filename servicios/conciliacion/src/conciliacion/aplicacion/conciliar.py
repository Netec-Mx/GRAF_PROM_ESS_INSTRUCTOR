"""Caso de uso: una corrida de conciliación."""

from collections.abc import Callable
from dataclasses import dataclass

from conciliacion.aplicacion.puertos import (
    DependenciaNoDisponibleError,
    PagosPort,
    PedidosPort,
    PublicacionFallidaError,
    PublicadorPort,
)
from conciliacion.dominio import Resultado, Ventana, conciliar, recortar


@dataclass(frozen=True, slots=True)
class Corrida:
    """Cómo terminó una corrida."""

    exitosa: bool
    duracion: float
    resultado: Resultado | None = None
    error: str | None = None


class Conciliar:
    """Trae pedidos y pagos, los cruza y publica el resultado.

    Solo concilia los pedidos creados entre ahora menos ventana y ahora menos gracia, las dos
    en segundos. La gracia deja fuera a los pedidos que el cliente todavía está pagando. La
    ventana deja fuera a los pedidos tan viejos que pagos pudo haber descartado ya su pago.

    reloj devuelve la hora actual como unix time; cronometro devuelve segundos de un reloj
    que solo avanza, para medir la duración.
    """

    def __init__(
        self,
        pedidos: PedidosPort,
        pagos: PagosPort,
        publicador: PublicadorPort,
        reloj: Callable[[], float],
        cronometro: Callable[[], float],
        ventana: float,
        gracia: float,
    ) -> None:
        self._pedidos = pedidos
        self._pagos = pagos
        self._publicador = publicador
        self._reloj = reloj
        self._cronometro = cronometro
        self._ventana = ventana
        self._gracia = gracia

    def ejecutar(self) -> Corrida:
        inicio = self._cronometro()
        # La ventana se fija al empezar: no se corre mientras llegan las respuestas.
        ventana = Ventana.hasta_ahora(self._reloj(), self._ventana, self._gracia)
        try:
            pedidos, pagos = recortar(self._pedidos.confirmados(), self._pagos.todos(), ventana)
        except DependenciaNoDisponibleError as error:
            return self._fallar(inicio, str(error))
        resultado = conciliar(pedidos, pagos)

        duracion = self._cronometro() - inicio
        try:
            self._publicador.publicar_exito(resultado, self._reloj(), duracion)
        except PublicacionFallidaError as error:
            # Sin publicar no hay corrida exitosa: nadie se enteraría del resultado.
            return Corrida(exitosa=False, duracion=duracion, error=str(error))
        return Corrida(exitosa=True, duracion=duracion, resultado=resultado)

    def _fallar(self, inicio: float, motivo: str) -> Corrida:
        duracion = self._cronometro() - inicio
        try:
            self._publicador.publicar_falla(self._reloj(), duracion)
        except PublicacionFallidaError as error:
            motivo = f"{motivo}; además no se pudo publicar la falla: {error}"
        return Corrida(exitosa=False, duracion=duracion, error=motivo)
