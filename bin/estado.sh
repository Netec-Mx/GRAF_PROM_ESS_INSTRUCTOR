#!/usr/bin/env bash
# Tabla con servicio, puerto en el host, health y URL.
# Sale con código 0 solo si todos los servicios están healthy.
set -u

. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

chequear_docker
asegurar_env

todos_bien=0

printf '%s%-15s %-12s %-18s %s%s\n' "$NEGRITA" "SERVICIO" "PUERTO" "HEALTH" "URL" "$NORMAL"
for servicio in $SERVICIOS; do
  salud="$(salud_de "$servicio")"
  case "$salud" in
    healthy)  color="$VERDE" ;;
    starting) color="$AMARILLO"; todos_bien=1 ;;
    *)        color="$ROJO"; todos_bien=1 ;;
  esac
  # El relleno se calcula antes de colorear para que la tabla no se descuadre.
  salud_rellena="$(printf '%-18s' "$salud")"
  printf '%-15s %-12s %s %s\n' "$servicio" "$(puertos_de "$servicio")" "${color}${salud_rellena}${NORMAL}" "$(url_de "$servicio")"
done

echo
if [ "$todos_bien" -eq 0 ]; then
  ok "Los $(echo $SERVICIOS | wc -w | tr -d ' ') servicios están healthy"
  echo "    Grafana: usuario $(leer_env GRAFANA_ADMIN_USER), contraseña en infra/.env (GRAFANA_ADMIN_PASSWORD)"
else
  aviso "Hay servicios que no están healthy"
fi
exit "$todos_bien"
