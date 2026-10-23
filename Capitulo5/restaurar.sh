#!/usr/bin/env bash
# Práctica 5. Devuelve a git el código de catalogo y la configuración de Alertmanager, borra
# las reglas y las pruebas que crea la práctica, y recarga Prometheus, Alertmanager y catalogo.
# Pide escribir SI. Sin SI no toca nada.
set -u

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source-path=SCRIPTDIR source=../_comun/lib-practicas.sh
. "$AQUI/../_comun/lib-practicas.sh"

# Archivos que existen en git y la práctica edita.
EDITADOS="servicios/catalogo/src/catalogo/metricas.py
servicios/catalogo/src/catalogo/api/rutas.py
infra/alertmanager/alertmanager.yml"

# Archivos que la práctica crea. No existen en git.
CREADOS="infra/prometheus/rules/tianguis-registro.yml
infra/prometheus/rules/tianguis-alertas.yml
infra/prometheus/pruebas/tianguis-alertas.test.yml"

command -v git >/dev/null 2>&1 || paro "No encuentro git en el PATH."
git -C "$RAIZ" rev-parse --is-inside-work-tree >/dev/null 2>&1 \
  || paro "Esta carpeta no es un repositorio de git. Copia los archivos desde una copia limpia del repo."

cambiados=""
for archivo in $EDITADOS; do
  git -C "$RAIZ" diff --quiet -- "$archivo" || cambiados="$cambiados $archivo"
done
for archivo in $CREADOS; do
  [ -e "$RAIZ/$archivo" ] && cambiados="$cambiados $archivo"
done

if [ -z "$cambiados" ]; then
  ok "catalogo, las reglas y Alertmanager ya están iguales a git. No hay nada que restaurar."
  exit 0
fi

echo "${ROJO}${NEGRITA}"
echo "============================================================"
echo "  SE VAN A SOBRESCRIBIR O BORRAR ESTOS ARCHIVOS"
for archivo in $cambiados; do
  echo "    $(printf '%s' "$archivo" | tr '[:lower:]' '[:upper:]')"
done
echo "============================================================"
echo "  LOS EDITADOS VUELVEN A LA VERSIÓN ORIGINAL DEL REPOSITORIO."
echo "  LAS REGLAS Y LAS PRUEBAS QUE CREASTE SE BORRAN."
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
for archivo in $CREADOS; do
  if [ -e "$RAIZ/$archivo" ]; then
    rm -f "$RAIZ/$archivo" || paro "No pude borrar $archivo."
    ok "$archivo borrado"
  fi
done
rmdir "$RAIZ/infra/prometheus/pruebas" 2>/dev/null || true

if [ "$(contenedor_estado gpe-prometheus)" = "running" ]; then
  docker exec gpe-prometheus kill -HUP 1 || paro "No pude recargar Prometheus."
  ok "Prometheus recargado sin las reglas de la práctica"
fi
if [ "$(contenedor_estado gpe-alertmanager)" = "running" ]; then
  curl -s --max-time 10 -X POST "http://localhost:$(leer_env PUERTO_ALERTMANAGER)/-/reload" >/dev/null \
    || paro "No pude recargar Alertmanager."
  ok "Alertmanager recargado con la configuración original"
fi

info "Reconstruyendo catalogo con el código original"
"$RAIZ/bin/up.sh" >/dev/null 2>&1 || paro "bin/up.sh falló. Córrelo a mano para ver el mensaje."
ok "catalogo reconstruido y el stack completo en healthy"
