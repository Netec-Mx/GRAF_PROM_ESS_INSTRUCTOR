#!/usr/bin/env bash
# Práctica 7. Revisa la capa de seguridad: TLS y autenticación en node_exporter, Prometheus y
# Alertmanager, Grafana por HTTPS con OAuth, roles, el token revocado y los secretos.
set -u

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source-path=SCRIPTDIR source=../_comun/lib-practicas.sh
. "$AQUI/../_comun/lib-practicas.sh"

TRABAJO="$AQUI/trabajo"
CA="$TRABAJO/certs/ca.crt"
COMPOSE_CAPA="$AQUI/compose.seguridad.yaml"
TOKEN="$TRABAJO/token-repartidor"
CARPETA="Pagos restringido"

# Clave de la interfaz de Prometheus y Alertmanager. Sale del secreto si ya existe.
clave_mirar() {
  if [ -f "$TRABAJO/secretos/mirar" ]; then cat "$TRABAJO/secretos/mirar"; else printf '%s' "mirar-2026"; fi
}

# codigo URL [opciones de curl]  ->  código HTTP de la respuesta, validando con la CA del curso.
# 000 si no hubo respuesta TLS válida.
codigo() {
  local url="$1"
  shift
  curl -s -o /dev/null -w '%{http_code}' --max-time 10 --cacert "$CA" "$@" "$url" 2>/dev/null
}

# con_clave URL  ->  respuesta autenticada como tianguis.
con_clave() {
  curl -s --max-time 10 --cacert "$CA" -u "tianguis:$(clave_mirar)" "$1" 2>/dev/null | tr -d '\r\n'
}

# grafana_tls RUTA [opciones de curl]  ->  API de Grafana por HTTPS como admin.
grafana_tls() {
  local ruta="$1"
  shift
  curl -s --max-time 10 --cacert "$CA" -u "$(leer_env GRAFANA_ADMIN_USER):$(leer_env GRAFANA_ADMIN_PASSWORD)" \
    "$@" "$GRAFANA_HTTPS$ruta" 2>/dev/null | tr -d '\r\n'
}

exigir_stack
[ -f "$CA" ] || aviso "No existe Capitulo7/trabajo/certs/ca.crt. Las revisiones de TLS van a fallar."

PROM="https://localhost:$(leer_env PUERTO_PROMETHEUS)"
NODO="https://localhost:$(leer_env PUERTO_NODE_EXPORTER)"
ALERTAS="https://localhost:$(leer_env PUERTO_ALERTMANAGER)"
GRAFANA_HTTPS="https://localhost:$(leer_env PUERTO_GRAFANA)"

echo "${NEGRITA}TLS y autenticación básica${NORMAL}"

while IFS='|' read -r nombre url; do
  c="$(codigo "$url")"
  if [ "$c" = "401" ]; then
    paso_ok "$nombre responde por TLS y pide clave, 401 sin credenciales"
  else
    paso_falla "$nombre no respondió 401 por TLS sin credenciales, respondió $c" \
      "Revisa su web config y aplica la capa con docker compose y los dos -f."
  fi
done <<FIN
node_exporter|$NODO/metrics
Prometheus|$PROM/api/v1/status/config
Alertmanager|$ALERTAS/api/v2/status
FIN

destinos="$(con_clave "$PROM/api/v1/targets?state=active")"
total="$(printf '%s\n' "$destinos" | grep -o '"health":"[a-z]*"' | grep -c health)"
caidos="$(printf '%s\n' "$destinos" | grep -o '"health":"[a-z]*"' | grep -c -v '"up"')"
if [ "$total" -gt 0 ] && [ "$caidos" -eq 0 ]; then
  paso_ok "Los $total destinos de Prometheus están UP"
else
  paso_falla "Hay $caidos destinos que no están UP de $total" "Abre Status, Target health en Prometheus y lee el error."
fi

tls=0
for destino in node-exporter:9100 prometheus:9090 alertmanager:9093; do
  printf '%s\n' "$destinos" | grep -q "\"scrapeUrl\":\"https://$destino/metrics\"" && tls=$((tls + 1))
done
if [ "$tls" -eq 3 ]; then
  paso_ok "node_exporter, Prometheus y Alertmanager se raspan por https"
else
  paso_falla "Solo $tls de 3 jobs se raspan por https" "Agrega scheme https, tls_config y basic_auth a los jobs."
fi

if con_clave "$PROM/api/v1/alertmanagers" | grep -q '"activeAlertmanagers":\[{"url":"https://alertmanager:9093'; then
  paso_ok "Prometheus le envía las alertas a Alertmanager por https"
else
  paso_falla "Prometheus no tiene un Alertmanager activo por https" "Agrega scheme, tls_config y basic_auth en alerting."
fi

echo
echo "${NEGRITA}Grafana${NORMAL}"

if [ "$(codigo "$GRAFANA_HTTPS/api/health")" = "200" ]; then
  paso_ok "Grafana responde por https con un certificado de la CA del curso"
else
  paso_falla "Grafana no responde por https con el certificado de la CA" "Revisa GF_SERVER_PROTOCOL y los archivos del certificado."
fi

if grafana_tls "/api/users/search?perpage=200" | grep -q '"authLabels":\["Generic OAuth"\]'; then
  paso_ok "Existe un usuario creado por el login con Dex"
else
  paso_falla "Ningún usuario entró con Dex" "Entra a Grafana con Sign in with Dex y un usuario de Dex."
fi

carpeta="$(grafana_tls "/api/search" -G --data-urlencode "type=dash-folder" --data-urlencode "query=$CARPETA" \
  | grep -o '"uid":"[^"]*"' | head -n 1 | cut -d'"' -f4)"
tablero=""
[ -n "$carpeta" ] && tablero="$(grafana_tls "/api/search" -G --data-urlencode "type=dash-db" --data-urlencode "folderUIDs=$carpeta" \
  | grep -o '"uid":"[^"]*"' | head -n 1 | cut -d'"' -f4)"
if [ -z "$tablero" ]; then
  paso_falla "La carpeta $CARPETA no existe o no tiene un dashboard" "Créala e importa en ella el dashboard de la guía."
else
  lee="$(codigo "$GRAFANA_HTTPS/api/dashboards/uid/$tablero" -u vera:vera-2026)"
  json="$(grafana_tls "/api/dashboards/uid/$tablero")"
  modelo="$(printf '%s' "$json" | sed 's/^{"meta":.*,"dashboard":\(.*\)}$/\1/')"
  guarda="$(codigo "$GRAFANA_HTTPS/api/dashboards/db" -u vera:vera-2026 -X POST -H 'Content-Type: application/json' \
    --data "{\"dashboard\":$modelo,\"folderUid\":\"$carpeta\",\"overwrite\":true}")"
  if [ "$guarda" = "403" ] && [ "$lee" != "200" ]; then
    paso_ok "vera, con rol Viewer, no puede abrir ni editar el dashboard de $CARPETA"
  else
    paso_falla "vera puede ver o editar el dashboard de $CARPETA (abrir $lee, guardar $guarda)" \
      "Quita los roles Viewer y Editor de los permisos de la carpeta y deja solo al equipo."
  fi
  if [ "$(codigo "$GRAFANA_HTTPS/api/dashboards/uid/$tablero" -u edu:edu-2026)" = "200" ]; then
    paso_ok "edu, del equipo equipo-pagos, sí puede abrirlo"
  else
    paso_falla "edu no puede abrir el dashboard de $CARPETA" "Agrega edu al equipo y da permiso Edit al equipo en la carpeta."
  fi
fi

if [ ! -f "$TOKEN" ] || ! grep -q '^glsa_' "$TOKEN"; then
  paso_falla "No existe Capitulo7/trabajo/token-repartidor con el token de la cuenta de servicio" \
    "Pega ahí el token que empieza con glsa_."
elif ! grafana_tls "/api/serviceaccounts/search?query=repartidor" | grep -q '"name":"repartidor"'; then
  paso_falla "No existe la cuenta de servicio repartidor" "Créala en Administration, Service accounts."
elif [ "$(codigo "$GRAFANA_HTTPS/api/search" -H "Authorization: Bearer $(tr -d '\r\n' < "$TOKEN")")" = "401" ]; then
  paso_ok "El token revocado de repartidor recibe 401"
else
  paso_falla "El token de repartidor todavía funciona" "Bórralo en la cuenta de servicio y vuelve a probar con curl."
fi

echo
echo "${NEGRITA}Secretos${NORMAL}"

if [ ! -f "$COMPOSE_CAPA" ] || ! grep -q 'services:' "$COMPOSE_CAPA"; then
  paso_falla "No existe Capitulo7/compose.seguridad.yaml" "Recupéralo con git checkout -- Capitulo7/compose.seguridad.yaml."
elif grep -v '^ *#' "$COMPOSE_CAPA" | grep -q -E 'raspar-2026|mirar-2026|ana-2026|beto-2026|secreto-de-grafana' \
  || grep -v '^ *#' "$COMPOSE_CAPA" | grep -v '__FILE' | grep -q -E '(PASSWORD|SECRET)[A-Z_]*: *[^" ]'; then
  paso_falla "compose.seguridad.yaml tiene una clave escrita" "Pásala a un archivo en trabajo/secretos y usa la variable __FILE."
else
  paso_ok "compose.seguridad.yaml no tiene claves escritas"
fi

if [ -f "$TRABAJO/prometheus/prometheus.yml" ] && grep -q 'password_file:' "$TRABAJO/prometheus/prometheus.yml" \
  && ! grep -q -E '^ *password: ' "$TRABAJO/prometheus/prometheus.yml"; then
  paso_ok "Prometheus lee sus claves de raspado con password_file"
else
  paso_falla "trabajo/prometheus/prometheus.yml todavía tiene claves escritas" "Cambia cada password por password_file."
fi

resumen
