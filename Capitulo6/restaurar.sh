#!/usr/bin/env bash
# Práctica 6. Devuelve el tráfico a nivel normal, apaga las fallas de caos, devuelve
# Capitulo6/hallazgo.md a git y borra Capitulo6/mi-dashboard.json. El dashboard
# Tianguis · Multiambiente se queda en Grafana. Pide escribir SI. Sin SI no toca nada.
set -u

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source-path=SCRIPTDIR source=../_comun/lib-practicas.sh
. "$AQUI/../_comun/lib-practicas.sh"

HALLAZGO="Capitulo6/hallazgo.md"
EXPORTADO="$AQUI/mi-dashboard.json"

command -v git >/dev/null 2>&1 || paro "No encuentro git en el PATH."
git -C "$RAIZ" rev-parse --is-inside-work-tree >/dev/null 2>&1 \
  || paro "Esta carpeta no es un repositorio de git. Copia el archivo desde una copia limpia del repo."
chequear_docker

echo "${ROJO}${NEGRITA}"
echo "============================================================"
echo "  EL TRÁFICO VUELVE A NIVEL NORMAL, SE APAGAN LAS FALLAS DE CAOS,"
echo "  SE SOBRESCRIBE CAPITULO6/HALLAZGO.MD Y SE BORRA"
echo "    CAPITULO6/MI-DASHBOARD.JSON"
echo "============================================================"
echo "  EL DASHBOARD TIANGUIS · MULTIAMBIENTE SIGUE EN GRAFANA."
echo "  NO HAY VUELTA ATRÁS."
echo "============================================================"
echo "${NORMAL}"

if ! confirmar_si; then
  echo
  ok "No se confirmó. No se tocó nada."
  exit 0
fi

"$RAIZ/bin/trafico.sh" nivel normal >/dev/null || paro "No pude dejar el tráfico en nivel normal."
"$RAIZ/bin/caos.sh" apagar >/dev/null || paro "No pude apagar las fallas de caos. Revisa bin/caos.sh estado."
ok "Tráfico normal y fallas de caos apagadas"
if ! git -C "$RAIZ" diff --quiet -- "$HALLAZGO"; then
  git -C "$RAIZ" checkout -- "$HALLAZGO" || paro "git no pudo restaurar $HALLAZGO."
  ok "$HALLAZGO restaurado"
fi
if [ -f "$EXPORTADO" ]; then
  rm -f "$EXPORTADO" || paro "No pude borrar Capitulo6/mi-dashboard.json."
  ok "Capitulo6/mi-dashboard.json borrado"
fi
