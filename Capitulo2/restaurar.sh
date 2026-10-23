#!/usr/bin/env bash
# Práctica 2. Devuelve infra/prometheus/prometheus.yml a su versión de git y recarga Prometheus.
# Pide escribir SI. Sin SI no toca nada.
set -u

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source-path=SCRIPTDIR source=../_comun/lib-practicas.sh
. "$AQUI/../_comun/lib-practicas.sh"

ARCHIVO="infra/prometheus/prometheus.yml"

command -v git >/dev/null 2>&1 || paro "No encuentro git en el PATH."
git -C "$RAIZ" rev-parse --is-inside-work-tree >/dev/null 2>&1 \
  || paro "Esta carpeta no es un repositorio de git. Copia el archivo desde una copia limpia del repo."

if git -C "$RAIZ" diff --quiet -- "$ARCHIVO"; then
  ok "$ARCHIVO ya está igual a la versión de git. No hay nada que restaurar."
  exit 0
fi

echo "${ROJO}${NEGRITA}"
echo "============================================================"
echo "  SE VA A SOBRESCRIBIR EL ARCHIVO"
echo "    INFRA/PROMETHEUS/PROMETHEUS.YML"
echo "============================================================"
echo "  VUELVE A LA VERSIÓN ORIGINAL DEL REPOSITORIO."
echo "  SE PIERDEN TODOS LOS CAMBIOS QUE HICISTE EN ESE ARCHIVO."
echo "  NO HAY VUELTA ATRÁS."
echo "============================================================"
echo "${NORMAL}"

if ! confirmar_si; then
  echo
  ok "No se confirmó. No se tocó nada."
  exit 0
fi

git -C "$RAIZ" checkout -- "$ARCHIVO" || paro "git no pudo restaurar $ARCHIVO."
ok "$ARCHIVO restaurado"

if [ "$(contenedor_estado gpe-prometheus)" = "running" ]; then
  docker exec gpe-prometheus kill -HUP 1 || paro "No pude recargar Prometheus."
  ok "Prometheus recargado con la configuración original"
else
  aviso "gpe-prometheus no está corriendo. Tomará la configuración original cuando levantes el stack."
fi
