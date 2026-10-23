#!/usr/bin/env bash
# Práctica 1. Devuelve Capitulo1/mapa-de-senales.md a su versión de git, con las tablas vacías.
# Pide escribir SI. Sin SI no toca nada.
set -u

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source-path=SCRIPTDIR source=../_comun/lib-practicas.sh
. "$AQUI/../_comun/lib-practicas.sh"

ARCHIVO="Capitulo1/mapa-de-senales.md"

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
echo "    CAPITULO1/MAPA-DE-SENALES.MD"
echo "============================================================"
echo "  VUELVE A LA VERSIÓN ORIGINAL DEL REPOSITORIO, CON LAS TABLAS VACÍAS."
echo "  SE PIERDE TODO LO QUE ESCRIBISTE EN ESE ARCHIVO."
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
