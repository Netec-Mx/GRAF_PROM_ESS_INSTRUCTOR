#!/usr/bin/env bash
# Levanta el stack de observabilidad y espera a que todos los healthchecks pasen.
set -u

. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

ESPERA_MAX=240   # segundos

chequear_docker
asegurar_env
chequear_env

info "Revisando puertos del host"
chequear_puertos
ok "Puertos libres"

info "Levantando el stack (proyecto $PROYECTO)"
# Sin esta variable, cada build le agrega a la imagen una atestación con la hora, el id de la
# imagen cambia aunque el código sea el mismo y Compose recrea catalogo y pedidos en cada up.
BUILDX_NO_DEFAULT_ATTESTATIONS=1 compose up -d --build --remove-orphans || paro "docker compose up falló. Revisa el mensaje de arriba."

info "Esperando healthchecks (máximo ${ESPERA_MAX}s)"
inicio=$(date +%s)
while :; do
  pendientes=""
  for servicio in $SERVICIOS; do
    [ "$(salud_de "$servicio")" = "healthy" ] || pendientes="$pendientes $servicio"
  done
  [ -z "$pendientes" ] && break
  transcurrido=$(( $(date +%s) - inicio ))
  if [ "$transcurrido" -ge "$ESPERA_MAX" ]; then
    echo
    error "Pasaron ${ESPERA_MAX}s y siguen sin estar healthy:$pendientes"
    "$BIN_DIR/estado.sh"
    echo
    aviso "Para ver por qué:  docker compose -p $PROYECTO logs --tail 50 <servicio>"
    exit 1
  fi
  printf '\r    %3ss  faltan:%s\033[K' "$transcurrido" "$pendientes"
  sleep 3
done
printf '\r\033[K'
ok "Todos los servicios están healthy"
echo

"$BIN_DIR/estado.sh"
