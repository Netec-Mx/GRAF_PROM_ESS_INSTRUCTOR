#!/usr/bin/env bash
# Práctica 8. Devuelve a git la configuración de Alloy y de Loki y Capitulo8/consultas.md, borra
# las reglas del ruler y recarga Alloy y Loki. Pide escribir SI. Sin SI no toca nada.
set -u

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source-path=SCRIPTDIR source=../_comun/lib-practicas.sh
. "$AQUI/../_comun/lib-practicas.sh"

EDITADOS="infra/alloy/config.alloy
infra/loki/loki.yaml
Capitulo8/consultas.md"
REGLAS="infra/loki/reglas"

command -v git >/dev/null 2>&1 || paro "No encuentro git en el PATH."
git -C "$RAIZ" rev-parse --is-inside-work-tree >/dev/null 2>&1 \
  || paro "Esta carpeta no es un repositorio de git. Copia los archivos desde una copia limpia del repo."

cambiados=""
for archivo in $EDITADOS; do
  git -C "$RAIZ" diff --quiet -- "$archivo" || cambiados="$cambiados $archivo"
done
[ -d "$RAIZ/$REGLAS" ] && cambiados="$cambiados $REGLAS"

if [ -z "$cambiados" ]; then
  ok "Alloy y Loki ya están iguales a git. No hay nada que restaurar."
  exit 0
fi

echo "${ROJO}${NEGRITA}"
echo "============================================================"
echo "  SE VAN A SOBRESCRIBIR O BORRAR"
for archivo in $cambiados; do
  echo "    $(printf '%s' "$archivo" | tr '[:lower:]' '[:upper:]')"
done
echo "============================================================"
echo "  LA CONFIGURACIÓN VUELVE A LA VERSIÓN ORIGINAL DEL REPOSITORIO."
echo "  LAS REGLAS DEL RULER SE BORRAN."
echo "  SE PIERDEN TODOS TUS CAMBIOS EN ESOS ARCHIVOS."
echo "  NO HAY VUELTA ATRÁS."
echo "============================================================"
echo "${NORMAL}"

if ! confirmar_si; then
  echo
  ok "No se confirmó. No se tocó nada."
  exit 0
fi

for archivo in $EDITADOS; do
  if ! git -C "$RAIZ" diff --quiet -- "$archivo"; then
    git -C "$RAIZ" checkout -- "$archivo" || paro "git no pudo restaurar $archivo."
    ok "$archivo restaurado"
  fi
done
if [ -d "$RAIZ/$REGLAS" ]; then
  rm -rf "${RAIZ:?}/$REGLAS" || paro "No pude borrar $REGLAS."
  ok "$REGLAS borrada"
fi

if [ "$(contenedor_estado gpe-alloy)" = "running" ]; then
  curl -s --max-time 10 -X POST "http://localhost:$(leer_env PUERTO_ALLOY)/-/reload" >/dev/null \
    || paro "No pude recargar Alloy."
  ok "Alloy recargado con la configuración original"
fi
if [ "$(contenedor_estado gpe-loki)" = "running" ]; then
  docker restart gpe-loki >/dev/null || paro "No pude reiniciar Loki."
  ok "Loki reiniciado con la configuración original"
fi
info "Esperando que el stack quede healthy"
"$RAIZ/bin/up.sh" >/dev/null 2>&1 || paro "bin/up.sh falló. Córrelo a mano para ver el mensaje."
ok "Alloy y Loki como estaban antes de la práctica"
