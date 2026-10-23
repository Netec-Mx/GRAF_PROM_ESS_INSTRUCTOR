#!/usr/bin/env bash
# Práctica 6. Deja el stack en el punto de partida: todo arriba, tráfico en nivel alto para que
# dev tenga datos visibles y la pasarela de pagos lenta en el 20 % de los cobros durante 60
# minutos, para que haya pagos lentos que seguir desde un exemplar.
set -u

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source-path=SCRIPTDIR source=../_comun/lib-practicas.sh
. "$AQUI/../_comun/lib-practicas.sh"

TITULO="Tianguis · Multiambiente"
ESPERA_MAX=90   # segundos

"$RAIZ/bin/up.sh" >/dev/null 2>&1 || paro "El stack no levantó. Corre bin/up.sh y revisa su mensaje."
"$RAIZ/bin/trafico.sh" nivel alto >/dev/null || paro "No pude dejar el tráfico en nivel alto."
"$RAIZ/bin/caos.sh" pagos pasarela_lenta ms=1500 porcentaje=20 duracion_s=3600 >/dev/null \
  || paro "No pude encender la pasarela lenta en pagos. Revisa bin/caos.sh estado."

if grafana_dashboard_existe "$TITULO" >/dev/null; then
  aviso "Ya existe un dashboard llamado $TITULO. Si repites la práctica, bórralo antes en Grafana."
fi

inicio=$(date +%s)
until prom_existe 'chaos_active{job="pagos", type="pasarela_lenta"} == 1'; do
  if [ $(( $(date +%s) - inicio )) -ge "$ESPERA_MAX" ]; then
    paro "Pasaron ${ESPERA_MAX}s y Prometheus no ve la pasarela lenta. Revisa bin/caos.sh estado."
  fi
  sleep 3
done

ok "Punto de partida de la Práctica 6 listo. Tráfico alto y pasarela lenta en pagos por 60 minutos."
echo "    Al terminar la práctica devuelve el tráfico a normal con bin/trafico.sh nivel normal."
