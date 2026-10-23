#!/usr/bin/env bash
# Práctica 9, Parte B. Empieza El Buen Fin. Sube el tráfico al nivel buenfin y enciende varias
# fallas a la vez durante 60 minutos. No dice cuáles. Encontrarlas es la práctica, así que no
# leas este archivo ni corras bin/caos.sh estado hasta terminar el diagnóstico.
set -u

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source-path=SCRIPTDIR source=../_comun/lib-practicas.sh
. "$AQUI/../_comun/lib-practicas.sh"

ESPERA_MAX=90   # segundos
DURACION=3600   # segundos que dura cada falla

# Con la capa de escala, Prometheus solo se ve a través de nginx.
prom_url() { echo "http://localhost:8088/prometheus"; }

[ "$(contenedor_salud gpe-nginx)" = "healthy" ] \
  || paro "gpe-nginx no está arriba. El Buen Fin se corre con la capa de escala de la Parte A."

"$RAIZ/bin/trafico.sh" nivel buenfin >/dev/null || paro "No pude subir el tráfico a nivel buenfin."

# encender SERVICIO FALLA [k=v ...]  ->  enciende una falla por DURACION segundos.
encender() {
  "$RAIZ/bin/caos.sh" "$@" duracion_s="$DURACION" >/dev/null \
    || paro "No pude encender una falla en $1. Revisa que el stack esté arriba con bin/estado.sh."
}

encender pedidos latencia ms=800 jitter_ms=300 porcentaje=60
encender pagos pasarela_lenta ms=2500 porcentaje=30
encender catalogo-dev errores porcentaje=40

inicio=$(date +%s)
until prom_existe 'sum(chaos_active) >= 3'; do
  if [ $(( $(date +%s) - inicio )) -ge "$ESPERA_MAX" ]; then
    paro "Pasaron ${ESPERA_MAX}s y Prometheus no ve las fallas. Revisa bin/estado.sh."
  fi
  sleep 3
done

ok "Empezó El Buen Fin. 40 clientes comprando a la vez y algo anda mal. Las fallas duran 60 minutos."
