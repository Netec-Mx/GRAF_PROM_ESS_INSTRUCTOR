#!/usr/bin/env bash
# Baja los contenedores del stack. NO borra volúmenes: los datos siguen ahí.
set -u

. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

chequear_docker
asegurar_env

info "Bajando el stack (proyecto $PROYECTO). Los volúmenes se conservan."
compose down --remove-orphans || paro "docker compose down falló."
ok "Stack abajo. Los datos de Prometheus, Loki, Tempo y Grafana siguen guardados."
echo "    Para volver a levantar:  bin/up.sh"
echo "    Para borrar los datos:   bin/reset.sh"
