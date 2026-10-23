#!/usr/bin/env bash
# Práctica 4. Apaga la falla de errores de catalogo y borra Capitulo4/mi-dashboard.json. El
# dashboard Tianguis · RED se queda en Grafana porque la Práctica 9 lo vuelve a usar.
# Pide escribir SI. Sin SI no toca nada.
set -u

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source-path=SCRIPTDIR source=../_comun/lib-practicas.sh
. "$AQUI/../_comun/lib-practicas.sh"

EXPORTADO="$AQUI/mi-dashboard.json"

chequear_docker

echo "${ROJO}${NEGRITA}"
echo "============================================================"
echo "  SE APAGAN TODAS LAS FALLAS DE CAOS Y SE BORRA"
echo "    CAPITULO4/MI-DASHBOARD.JSON"
echo "============================================================"
echo "  EL DASHBOARD TIANGUIS · RED SIGUE EN GRAFANA."
echo "  NO HAY VUELTA ATRÁS."
echo "============================================================"
echo "${NORMAL}"

if ! confirmar_si; then
  echo
  ok "No se confirmó. No se tocó nada."
  exit 0
fi

"$RAIZ/bin/caos.sh" apagar >/dev/null || paro "No pude apagar las fallas de caos. Revisa bin/caos.sh estado."
ok "Fallas de caos apagadas"
if [ -f "$EXPORTADO" ]; then
  rm -f "$EXPORTADO" || paro "No pude borrar Capitulo4/mi-dashboard.json."
  ok "Capitulo4/mi-dashboard.json borrado"
fi
