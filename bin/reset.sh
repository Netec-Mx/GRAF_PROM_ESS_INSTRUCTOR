#!/usr/bin/env bash
# Borra los volúmenes del proyecto gpe. Destructivo e irreversible.
# Solo actúa si se escribe SI. No toca nada que no sea del proyecto.
set -u

. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

chequear_docker
asegurar_env

volumenes="$(docker volume ls -q --filter "label=com.docker.compose.project=$PROYECTO")"

echo "${ROJO}${NEGRITA}"
echo "============================================================"
echo "  ESTO BORRA TODOS LOS DATOS DEL STACK ${PROYECTO}"
echo "============================================================"
echo "  SE PIERDE:"
echo "    - TODAS LAS MÉTRICAS GUARDADAS EN PROMETHEUS"
echo "    - TODOS LOS LOGS GUARDADOS EN LOKI"
echo "    - TODAS LAS TRAZAS GUARDADAS EN TEMPO"
echo "    - TODO LO HECHO A MANO EN GRAFANA: DASHBOARDS, USUARIOS,"
echo "      CONTRASEÑAS CAMBIADAS, ALERTAS Y PREFERENCIAS"
echo
echo "  NO HAY VUELTA ATRÁS. NO EXISTE RESPALDO."
echo "============================================================"
echo "${NORMAL}"

if [ -n "$volumenes" ]; then
  echo "Volúmenes que se van a borrar:"
  for v in $volumenes; do echo "    $v"; done
else
  echo "No hay volúmenes del proyecto $PROYECTO. Solo se bajarían los contenedores."
fi
echo

printf 'Para confirmar escribe SI en mayúsculas y pulsa Enter: '
respuesta=""
read -r respuesta || respuesta=""
respuesta="$(printf '%s' "$respuesta" | tr -d '\r')"

if [ "$respuesta" != "SI" ]; then
  echo
  ok "No se confirmó. No se borró nada."
  exit 0
fi

info "Bajando contenedores y borrando volúmenes del proyecto $PROYECTO"
compose down --volumes --remove-orphans || paro "docker compose down falló."
ok "Volúmenes borrados. bin/up.sh levanta el stack desde cero."
