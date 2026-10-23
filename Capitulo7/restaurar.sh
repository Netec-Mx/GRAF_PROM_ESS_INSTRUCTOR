#!/usr/bin/env bash
# Práctica 7. Baja la capa de seguridad y deja el stack base como estaba antes de la práctica.
# Vuelve a levantar el stack sin compose.seguridad.yaml, borra en Grafana los usuarios, el
# equipo, la carpeta y la cuenta de servicio de la práctica, borra Capitulo7/trabajo/ y devuelve
# Capitulo7/compose.seguridad.yaml a git. Pide escribir SI. Sin SI no toca nada.
set -u

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source-path=SCRIPTDIR source=../_comun/lib-practicas.sh
. "$AQUI/../_comun/lib-practicas.sh"

TRABAJO="$AQUI/trabajo"
COMPOSE_CAPA="Capitulo7/compose.seguridad.yaml"
USUARIOS="vera edu ana@tianguis.local beto@tianguis.local"
EQUIPO="equipo-pagos"
CARPETA="Pagos restringido"
CUENTA="repartidor"

command -v git >/dev/null 2>&1 || paro "No encuentro git en el PATH."
chequear_docker

echo "${ROJO}${NEGRITA}"
echo "============================================================"
echo "  SE VA A BAJAR LA CAPA DE SEGURIDAD Y SE VA A BORRAR"
echo "    CAPITULO7/TRABAJO/ COMPLETA, CON CERTIFICADOS, CLAVES Y SECRETOS"
echo "    LOS CAMBIOS DE CAPITULO7/COMPOSE.SEGURIDAD.YAML"
echo "    EN GRAFANA LOS USUARIOS VERA, EDU, ANA Y BETO, EL EQUIPO $(printf '%s' "$EQUIPO" | tr '[:lower:]' '[:upper:]'),"
echo "    LA CARPETA $(printf '%s' "$CARPETA" | tr '[:lower:]' '[:upper:]') CON SUS DASHBOARDS Y LA CUENTA DE SERVICIO $(printf '%s' "$CUENTA" | tr '[:lower:]' '[:upper:]')"
echo "============================================================"
echo "  EL STACK VUELVE A LEVANTARSE SIN TLS NI AUTENTICACIÓN."
echo "  NO HAY VUELTA ATRÁS."
echo "============================================================"
echo "${NORMAL}"

if ! confirmar_si; then
  echo
  ok "No se confirmó. No se tocó nada."
  exit 0
fi

info "Levantando el stack base, sin la capa de seguridad"
"$RAIZ/bin/up.sh" >/dev/null 2>&1 || paro "bin/up.sh falló. Córrelo a mano para ver el mensaje."
ok "Stack base arriba. Dex quedó fuera porque no está en infra/compose.yaml"

for usuario in $USUARIOS; do
  id="$(grafana_api "/api/users/lookup" -G --data-urlencode "loginOrEmail=$usuario" | grep -o '"id":[0-9]*' | head -n 1 | cut -d: -f2)"
  if [ -n "$id" ]; then
    grafana_api "/api/admin/users/$id" -X DELETE >/dev/null
    ok "Usuario $usuario borrado de Grafana"
  fi
done

id="$(grafana_api "/api/teams/search" -G --data-urlencode "name=$EQUIPO" | grep -o '"id":[0-9]*' | head -n 1 | cut -d: -f2)"
if [ -n "$id" ]; then
  grafana_api "/api/teams/$id" -X DELETE >/dev/null
  ok "Equipo $EQUIPO borrado"
fi

uid="$(grafana_api "/api/search" -G --data-urlencode "type=dash-folder" --data-urlencode "query=$CARPETA" | grep -o '"uid":"[^"]*"' | head -n 1 | cut -d'"' -f4)"
if [ -n "$uid" ]; then
  grafana_api "/api/folders/$uid?forceDeleteRules=true" -X DELETE >/dev/null
  ok "Carpeta $CARPETA borrada con sus dashboards"
fi

id="$(grafana_api "/api/serviceaccounts/search" -G --data-urlencode "query=$CUENTA" | grep -o '"id":[0-9]*' | head -n 1 | cut -d: -f2)"
if [ -n "$id" ]; then
  grafana_api "/api/serviceaccounts/$id" -X DELETE >/dev/null
  ok "Cuenta de servicio $CUENTA borrada"
fi

if [ -d "$TRABAJO" ]; then
  rm -rf "$TRABAJO" || paro "No pude borrar Capitulo7/trabajo/."
  ok "Capitulo7/trabajo/ borrada"
fi
if ! git -C "$RAIZ" diff --quiet -- "$COMPOSE_CAPA"; then
  git -C "$RAIZ" checkout -- "$COMPOSE_CAPA" || paro "git no pudo restaurar $COMPOSE_CAPA."
  ok "$COMPOSE_CAPA igual a git"
fi

ok "Stack base listo para la práctica siguiente"
