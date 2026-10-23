#!/usr/bin/env bash
# Práctica 2. Revisa en el stack real lo que la guía pide dejar hecho.
set -u

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source-path=SCRIPTDIR source=../_comun/lib-practicas.sh
. "$AQUI/../_comun/lib-practicas.sh"

exigir_stack

echo "${NEGRITA}Prometheus${NORMAL}"

destinos="$(prom_destinos)"
arriba="${destinos% *}"
total="${destinos#* }"
if [ "$total" -ge 12 ] && [ "$arriba" -eq "$total" ]; then
  paso_ok "Los $total destinos de Prometheus están UP"
else
  paso_falla "Hay destinos caídos, $arriba de $total están UP" \
    "Míralos en Status, Target health. Si es catalogo-dev, enciéndelo con docker start gpe-catalogo-dev."
fi

if MSYS_NO_PATHCONV=1 docker exec gpe-prometheus promtool check config /etc/prometheus/prometheus.yml >/dev/null 2>&1; then
  paso_ok "promtool acepta infra/prometheus/prometheus.yml"
else
  paso_falla "promtool rechaza infra/prometheus/prometheus.yml" \
    "Corre promtool check config como en la guía y corrige lo que indique."
fi

if [ "$(prom_destinos_con catalogo equipo tienda)" -eq 2 ]; then
  paso_ok "Los dos destinos de catalogo llevan la etiqueta equipo=\"tienda\""
else
  paso_falla "Los destinos de catalogo no llevan equipo=\"tienda\"" \
    "Agrega relabel_configs al job catalogo, valida con promtool y recarga con docker exec gpe-prometheus kill -HUP 1."
fi

if prom_existe 'http_server_requests_total{job="catalogo", equipo="tienda"}'; then
  paso_ok "http_server_requests_total de catalogo ya trae equipo=\"tienda\""
else
  paso_falla "http_server_requests_total de catalogo no trae equipo=\"tienda\"" \
    "Después de recargar espera unos 30 segundos y vuelve a verificar."
fi

echo
echo "${NEGRITA}Grafana${NORMAL}"

manuales="$(grafana_api /api/datasources | grep -o '"readOnly":false' | grep -c 'readOnly')"
if [ "$manuales" -eq 0 ]; then
  paso_ok "No quedó ningún datasource de práctica"
else
  paso_falla "Quedan $manuales datasources creados a mano" \
    "En Connections, Data sources, abre el que creaste y usa Delete."
fi

if uid="$(grafana_dashboard_existe "Primer vistazo")"; then
  paso_ok "Existe el dashboard Tianguis · Primer vistazo"
  json="$(grafana_dashboard_json "$uid")"

  paneles="$(grafana_dashboard_paneles "$uid")"
  if [ "$paneles" -ge 2 ]; then
    paso_ok "El dashboard tiene $paneles paneles"
  else
    paso_falla "El dashboard tiene $paneles paneles y necesita al menos 2" "Agrega el Stat y el Time series de la guía y guarda."
  fi

  if printf '%s\n' "$json" | grep -q '"type":"stat"' && printf '%s\n' "$json" | grep -q '"expr":"[^"]*sum(up)'; then
    paso_ok "Hay un panel Stat con sum(up)"
  else
    paso_falla "Falta el panel Stat con sum(up)" "Créalo en la pestaña Salud y guarda el dashboard."
  fi

  if printf '%s\n' "$json" | grep -q '"expr":"[^"]*http_server_requests_total'; then
    paso_ok "Hay un panel que consulta http_server_requests_total"
  else
    paso_falla "Ningún panel consulta http_server_requests_total" "Crea el Time series de la pestaña Tráfico y guarda el dashboard."
  fi

  grupos="$(grafana_dashboard_grupos "$uid")"
  if [ "$grupos" -ge 2 ]; then
    paso_ok "Los paneles están separados en $grupos filas o pestañas"
  else
    paso_falla "Los paneles no están separados en filas o pestañas" "Deja el Stat en Salud y el Time series en Tráfico."
  fi
else
  paso_falla "No existe el dashboard Tianguis · Primer vistazo" \
    "Créalo en Grafana y guárdalo con ese título. Las verificaciones de sus paneles quedan pendientes."
fi

resumen
