#!/usr/bin/env bash
# Práctica 5. Deja el stack en el punto de partida: todo arriba, tráfico en nivel normal y
# ninguna falla de caos encendida. Avisa si quedan archivos de una corrida anterior.
set -u

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source-path=SCRIPTDIR source=../_comun/lib-practicas.sh
. "$AQUI/../_comun/lib-practicas.sh"

ESPERA_MAX=90   # segundos

"$RAIZ/bin/up.sh" >/dev/null 2>&1 || paro "El stack no levantó. Corre bin/up.sh y revisa su mensaje."
"$RAIZ/bin/trafico.sh" nivel normal >/dev/null || paro "No pude dejar el tráfico en nivel normal."
"$RAIZ/bin/caos.sh" apagar >/dev/null || paro "No pude apagar las fallas de caos. Revisa bin/caos.sh estado."

inicio=$(date +%s)
until prom_existe 'sum(chaos_active) == 0'; do
  if [ $(( $(date +%s) - inicio )) -ge "$ESPERA_MAX" ]; then
    paro "Pasaron ${ESPERA_MAX}s y Prometheus todavía ve fallas encendidas. Revisa bin/caos.sh estado."
  fi
  sleep 3
done

# Archivos que la práctica crea o edita. Si ya cambiaron, es una corrida anterior.
if ! git -C "$RAIZ" diff --quiet -- servicios/catalogo infra/alertmanager 2>/dev/null \
  || [ -n "$(ls "$RAIZ"/infra/prometheus/rules/tianguis-*.yml "$RAIZ"/infra/prometheus/pruebas/*.yml 2>/dev/null)" ]; then
  aviso "Hay cambios de una corrida anterior en catalogo, en las reglas o en Alertmanager."
  echo "    Para empezar desde cero corre Capitulo5/restaurar.sh."
fi

ok "Punto de partida de la Práctica 5 listo. Tráfico normal y ninguna falla de caos encendida."
