#!/usr/bin/env bash
# Práctica 4. Deja el stack en el punto de partida: todo arriba, tráfico en nivel normal y una
# falla de errores en catalogo, el 20 % de sus respuestas durante 60 minutos, para que el
# dashboard tenga algo rojo que mostrar.
set -u

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source-path=SCRIPTDIR source=../_comun/lib-practicas.sh
. "$AQUI/../_comun/lib-practicas.sh"

TITULO="Tianguis · RED"
ESPERA_MAX=90   # segundos

"$RAIZ/bin/up.sh" >/dev/null 2>&1 || paro "El stack no levantó. Corre bin/up.sh y revisa su mensaje."
"$RAIZ/bin/trafico.sh" nivel normal >/dev/null || paro "No pude dejar el tráfico en nivel normal."
"$RAIZ/bin/caos.sh" catalogo errores porcentaje=20 duracion_s=3600 >/dev/null \
  || paro "No pude encender la falla de errores en catalogo. Revisa bin/caos.sh estado."

if grafana_dashboard_existe "$TITULO" >/dev/null; then
  aviso "Ya existe un dashboard llamado $TITULO. Si repites la práctica, bórralo antes en Grafana."
fi

inicio=$(date +%s)
until prom_existe 'chaos_active{job="catalogo", ambiente="prod", type="errores"} == 1'; do
  if [ $(( $(date +%s) - inicio )) -ge "$ESPERA_MAX" ]; then
    paro "Pasaron ${ESPERA_MAX}s y Prometheus no ve la falla encendida. Revisa bin/caos.sh estado."
  fi
  sleep 3
done

ok "Punto de partida de la Práctica 4 listo. La falla de errores de catalogo se apaga sola en 60 minutos."
