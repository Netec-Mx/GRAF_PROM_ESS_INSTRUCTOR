#!/usr/bin/env bash
# Práctica 8. Deja el stack base en el punto de partida: todo arriba sin la capa de seguridad de
# la Práctica 7, tráfico en nivel normal y una falla de errores en catalogo, el 15 % de sus
# respuestas durante 60 minutos, para que los logs tengan errores que buscar.
set -u

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source-path=SCRIPTDIR source=../_comun/lib-practicas.sh
. "$AQUI/../_comun/lib-practicas.sh"

ESPERA_MAX=90   # segundos

if [ -d "$RAIZ/Capitulo7/trabajo" ]; then
  aviso "Queda Capitulo7/trabajo de la Práctica 7. bin/up.sh baja su capa de seguridad igual."
fi

"$RAIZ/bin/up.sh" >/dev/null 2>&1 || paro "El stack no levantó. Corre bin/up.sh y revisa su mensaje."
"$RAIZ/bin/trafico.sh" nivel normal >/dev/null || paro "No pude dejar el tráfico en nivel normal."
"$RAIZ/bin/caos.sh" catalogo errores porcentaje=15 duracion_s=3600 >/dev/null \
  || paro "No pude encender la falla de errores en catalogo. Revisa bin/caos.sh estado."

inicio=$(date +%s)
until prom_existe 'chaos_active{job="catalogo", ambiente="prod", type="errores"} == 1'; do
  if [ $(( $(date +%s) - inicio )) -ge "$ESPERA_MAX" ]; then
    paro "Pasaron ${ESPERA_MAX}s y Prometheus no ve la falla encendida. Revisa bin/caos.sh estado."
  fi
  sleep 3
done

if ! git -C "$RAIZ" diff --quiet -- infra/alloy infra/loki 2>/dev/null || [ -d "$RAIZ/infra/loki/reglas" ]; then
  aviso "Hay cambios de una corrida anterior en infra/alloy o infra/loki."
  echo "    Para empezar desde cero corre Capitulo8/restaurar.sh."
fi

ok "Punto de partida de la Práctica 8 listo. La falla de errores de catalogo se apaga sola en 60 minutos."
