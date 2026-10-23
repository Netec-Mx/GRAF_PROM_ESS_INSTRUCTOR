#!/usr/bin/env bash
# Práctica 4, solución. Importa el dashboard Tianguis · RED resuelto en Grafana y deja su JSON en
# Capitulo4/mi-dashboard.json, como si se hubiera exportado. Pide escribir SI. Sin SI no toca nada.
set -u

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source-path=SCRIPTDIR source=../../_comun/lib-practicas.sh
. "$AQUI/../../_comun/lib-practicas.sh"

exigir_stack
confirmar_cambios 4 "EL DASHBOARD TIANGUIS · RED SE REEMPLAZA EN GRAFANA" \
  "CAPITULO4/MI-DASHBOARD.JSON SE REEMPLAZA CON EL RESUELTO"

grafana_importar "$AQUI/tianguis-red.json" || paro "Grafana rechazó el dashboard Tianguis · RED."
ok "Dashboard Tianguis · RED importado"
cp "$AQUI/tianguis-red.json" "$RAIZ/Capitulo4/mi-dashboard.json" || paro "No pude copiar el JSON."
ok "Capitulo4/mi-dashboard.json con el dashboard resuelto"
