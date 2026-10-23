#!/usr/bin/env bash
# Práctica 2, solución. Copia el prometheus.yml resuelto, lo valida y recarga Prometheus, enciende
# gpe-catalogo-dev, importa el dashboard Tianguis · Primer vistazo y espera a que Prometheus
# refleje todo. Pide escribir SI. Sin SI no toca nada.
set -u

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source-path=SCRIPTDIR source=../../_comun/lib-practicas.sh
. "$AQUI/../../_comun/lib-practicas.sh"

exigir_stack
confirmar_cambios 2 "INFRA/PROMETHEUS/PROMETHEUS.YML SE REEMPLAZA CON EL RESUELTO" \
  "EL DASHBOARD TIANGUIS · PRIMER VISTAZO SE REEMPLAZA EN GRAFANA"

copiar_adentro "$AQUI/prometheus.yml" "$RAIZ/infra/prometheus/prometheus.yml" gpe-prometheus /etc/prometheus/prometheus.yml
MSYS_NO_PATHCONV=1 docker exec gpe-prometheus promtool check config /etc/prometheus/prometheus.yml >/dev/null 2>&1 \
  || paro "promtool rechaza el prometheus.yml de la solución."
docker exec gpe-prometheus kill -HUP 1 || paro "No pude recargar Prometheus."
ok "prometheus.yml resuelto y Prometheus recargado"

docker start gpe-catalogo-dev >/dev/null || paro "No pude encender gpe-catalogo-dev."
ok "gpe-catalogo-dev encendido"

grafana_importar "$AQUI/tianguis-primer-vistazo.json" || paro "Grafana rechazó el dashboard Tianguis · Primer vistazo."
ok "Dashboard Tianguis · Primer vistazo importado"

todo_arriba() {
  local destinos
  destinos="$(prom_destinos)"
  [ "${destinos% *}" = "${destinos#* }" ] && prom_existe 'http_server_requests_total{job="catalogo", equipo="tienda"}'
}
info "Esperando que Prometheus vea todos los destinos arriba y la etiqueta equipo"
esperar_hasta 180 "los destinos arriba y la etiqueta equipo en catalogo" todo_arriba
ok "Solución de la Práctica 2 aplicada"
