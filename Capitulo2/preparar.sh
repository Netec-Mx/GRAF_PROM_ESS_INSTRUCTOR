#!/usr/bin/env bash
# Práctica 2. Deja el stack en el punto de partida: todo arriba, tráfico en nivel normal y
# gpe-catalogo-dev detenido a propósito, para que el alumno encuentre un destino caído.
set -u

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source-path=SCRIPTDIR source=../_comun/lib-practicas.sh
. "$AQUI/../_comun/lib-practicas.sh"

ARCHIVO="infra/prometheus/prometheus.yml"
ESPERA_MAX=90   # segundos

"$RAIZ/bin/up.sh" >/dev/null 2>&1 || paro "El stack no levantó. Corre bin/up.sh y revisa su mensaje."
"$RAIZ/bin/trafico.sh" nivel normal >/dev/null || paro "No pude dejar el tráfico en nivel normal."

if git -C "$RAIZ" rev-parse --is-inside-work-tree >/dev/null 2>&1 \
  && ! git -C "$RAIZ" diff --quiet -- "$ARCHIVO"; then
  aviso "$ARCHIVO ya tiene cambios. Para empezar la práctica de cero corre Capitulo2/restaurar.sh."
fi
if grafana_dashboard_existe "Primer vistazo" >/dev/null; then
  aviso "Ya existe un dashboard llamado Primer vistazo. Si repites la práctica, bórralo antes en Grafana."
fi

docker stop gpe-catalogo-dev >/dev/null || paro "No pude preparar gpe-catalogo-dev."

inicio=$(date +%s)
until prom_existe 'up{job="catalogo", ambiente="dev"} == 0'; do
  if [ $(( $(date +%s) - inicio )) -ge "$ESPERA_MAX" ]; then
    paro "Pasaron ${ESPERA_MAX}s y Prometheus no refleja el punto de partida. Revisa bin/estado.sh."
  fi
  sleep 3
done

ok "Punto de partida de la Práctica 2 listo"
