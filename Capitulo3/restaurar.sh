#!/usr/bin/env bash
# Práctica 3. Devuelve Capitulo3/consultas.md a su versión de git, con las respuestas vacías, y
# apaga las fallas de caos. Pide escribir SI. Sin SI no toca nada.
set -u

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source-path=SCRIPTDIR source=../_comun/lib-practicas.sh
. "$AQUI/../_comun/lib-practicas.sh"

ARCHIVO="Capitulo3/consultas.md"

command -v git >/dev/null 2>&1 || paro "No encuentro git en el PATH."
git -C "$RAIZ" rev-parse --is-inside-work-tree >/dev/null 2>&1 \
  || paro "Esta carpeta no es un repositorio de git. Copia el archivo desde una copia limpia del repo."
chequear_docker

echo "${ROJO}${NEGRITA}"
echo "============================================================"
echo "  SE VA A SOBRESCRIBIR EL ARCHIVO"
echo "    CAPITULO3/CONSULTAS.MD"
echo "  Y SE APAGAN TODAS LAS FALLAS DE CAOS"
echo "============================================================"
echo "  EL ARCHIVO VUELVE A LA VERSIÓN ORIGINAL DEL REPOSITORIO."
echo "  SE PIERDEN TODAS LAS CONSULTAS QUE ESCRIBISTE AHÍ."
echo "  NO HAY VUELTA ATRÁS."
echo "============================================================"
echo "${NORMAL}"

if ! confirmar_si; then
  echo
  ok "No se confirmó. No se tocó nada."
  exit 0
fi

if ! git -C "$RAIZ" diff --quiet -- "$ARCHIVO"; then
  git -C "$RAIZ" checkout -- "$ARCHIVO" || paro "git no pudo restaurar $ARCHIVO."
  ok "$ARCHIVO restaurado"
fi
"$RAIZ/bin/caos.sh" apagar >/dev/null || paro "No pude apagar las fallas de caos. Revisa bin/caos.sh estado."
ok "Fallas de caos apagadas"
