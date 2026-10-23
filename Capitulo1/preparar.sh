#!/usr/bin/env bash
# Práctica 1. Deja el stack en el punto de partida: todo arriba, tráfico en nivel normal,
# pagos ya con cobros registrados y conciliacion con al menos una corrida en el Pushgateway.
set -u

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source-path=SCRIPTDIR source=../_comun/lib-practicas.sh
. "$AQUI/../_comun/lib-practicas.sh"

ESPERA_MAX=120   # segundos

info "Levantando el stack. La primera vez tarda varios minutos."
"$RAIZ/bin/up.sh" >/dev/null 2>&1 || paro "El stack no levantó. Corre bin/up.sh y revisa su mensaje."
"$RAIZ/bin/trafico.sh" nivel normal >/dev/null || paro "No pude dejar el tráfico en nivel normal."

if ! prom_existe 'conciliacion_last_run_success'; then
  info "conciliacion todavía no deja nada en el Pushgateway. Pido una corrida ahora."
  "$RAIZ/bin/conciliar.sh" >/dev/null 2>&1 || aviso "La corrida manual de conciliacion no terminó bien."
fi

info "Esperando a que Prometheus tenga cobros de pagos y la corrida de conciliacion"
inicio=$(date +%s)
until prom_existe 'payments_processed_total' && prom_existe 'conciliacion_last_run_success'; do
  if [ $(( $(date +%s) - inicio )) -ge "$ESPERA_MAX" ]; then
    paro "Pasaron ${ESPERA_MAX}s y Prometheus no tiene esas métricas. Revisa bin/estado.sh y bin/trafico.sh estado."
  fi
  sleep 3
done

ok "Punto de partida de la Práctica 1 listo"
echo "    Prometheus   $(url_de prometheus)"
echo "    Pushgateway  $(url_de pushgateway)"
