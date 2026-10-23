#!/usr/bin/env bash
# Práctica 7, solución. Arma Capitulo7/trabajo/ con generar.sh, aplica la capa de seguridad y hace
# en Grafana lo que la guía pide hacer en la interfaz. Entra una vez con Dex, crea a vera y a edu,
# el equipo equipo-pagos, la carpeta Pagos restringido con el dashboard Host · USE y la cuenta de
# servicio repartidor con un token que después revoca. Pide escribir SI. Sin SI no toca nada.
set -u

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source-path=SCRIPTDIR source=../../_comun/lib-practicas.sh
. "$AQUI/../../_comun/lib-practicas.sh"

TRABAJO="$RAIZ/Capitulo7/trabajo"
CA="$TRABAJO/certs/ca.crt"
CARPETA="Pagos restringido"
CAPA_SANA="gpe-node-exporter gpe-prometheus gpe-alertmanager gpe-grafana gpe-dex"
GRAFANA_HTTPS="https://localhost:$(leer_env PUERTO_GRAFANA)"
PROM="https://localhost:$(leer_env PUERTO_PROMETHEUS)"

# grafana_tls RUTA [opciones de curl]  ->  API de Grafana por HTTPS como admin.
grafana_tls() {
  local ruta="$1"
  shift
  curl -s --max-time 15 --cacert "$CA" -u "$(leer_env GRAFANA_ADMIN_USER):$(leer_env GRAFANA_ADMIN_PASSWORD)" \
    -H 'Content-Type: application/json' "$@" "$GRAFANA_HTTPS$ruta" 2>/dev/null | tr -d '\r\n'
}

# id_de RESPUESTA  ->  el primer "id" numérico de una respuesta de la API.
id_de() { printf '%s' "$1" | grep -o '"id":[0-9]*' | head -n 1 | cut -d: -f2; }

capa_sana() {
  local c
  for c in $CAPA_SANA; do
    [ "$(contenedor_salud "$c")" = "healthy" ] || return 1
  done
  [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 --cacert "$CA" "$GRAFANA_HTTPS/api/health")" = "200" ]
}

destinos_arriba() {
  local destinos
  destinos="$(curl -s --max-time 10 --cacert "$CA" -u "tianguis:$(cat "$TRABAJO/secretos/mirar")" \
    "$PROM/api/v1/targets?state=active" | tr -d '\r\n' | grep -o '"health":"[a-z]*"')"
  [ -n "$destinos" ] && ! printf '%s\n' "$destinos" | grep -q -v '"up"'
}

# entrar_con_dex EMAIL CLAVE  ->  recorre el login de Grafana con Dex como lo hace el navegador.
# Grafana manda a Dex, Dex muestra su formulario, recibe la clave y devuelve a Grafana con el código.
entrar_con_dex() {
  local frasco formulario
  frasco="$(mktemp)"
  formulario="$(curl -s -L --max-time 20 --cacert "$CA" -c "$frasco" -b "$frasco" -o /dev/null \
    -w '%{url_effective}' "$GRAFANA_HTTPS/login/generic_oauth")"
  curl -s -L --max-time 20 --cacert "$CA" -c "$frasco" -b "$frasco" -o /dev/null \
    --data-urlencode "login=$1" --data-urlencode "password=$2" "$formulario"
  rm -f "$frasco"
}

chequear_docker
command -v openssl >/dev/null 2>&1 || paro "No encuentro openssl. En Windows viene con Git Bash."
confirmar_cambios 7 "CAPITULO7/TRABAJO/ Y CAPITULO7/COMPOSE.SEGURIDAD.YAML SE REEMPLAZAN" \
  "EN GRAFANA SE CREAN USUARIOS, UN EQUIPO, UNA CARPETA Y UNA CUENTA DE SERVICIO"

# --- Capa de seguridad -----------------------------------------------------------------------
rm -rf "$TRABAJO"
"$AQUI/generar.sh" >/dev/null || paro "generar.sh no pudo armar Capitulo7/trabajo/."
ok "Capitulo7/trabajo/ resuelto con certificados, secretos y hashes"

info "Aplicando la capa de seguridad"
docker compose -p gpe --env-file "$ENV_FILE" -f "$COMPOSE_FILE" -f "$RAIZ/Capitulo7/compose.seguridad.yaml" \
  up -d >/dev/null 2>&1 || paro "docker compose no pudo aplicar la capa de seguridad."
esperar_hasta 300 "la capa de seguridad healthy" capa_sana
esperar_hasta 180 "los destinos de Prometheus arriba por TLS" destinos_arriba
ok "Capa de seguridad arriba, todos los destinos UP"

# --- Login con Dex ---------------------------------------------------------------------------
entrar_con_dex ana@tianguis.local ana-2026
grafana_tls "/api/users/search?perpage=200" | grep -q '"authLabels":\["Generic OAuth"\]' \
  || paro "El login con Dex no creó el usuario de ana en Grafana."
ok "ana entró con Dex"

# --- Usuarios, equipo y carpeta --------------------------------------------------------------
for usuario in vera edu; do
  grafana_tls /api/admin/users -X POST \
    --data "{\"name\":\"$usuario\",\"login\":\"$usuario\",\"email\":\"$usuario@tianguis.local\",\"password\":\"$usuario-2026\"}" >/dev/null
done
edu="$(id_de "$(grafana_tls "/api/users/lookup?loginOrEmail=edu")")"
[ -n "$edu" ] || paro "No pude crear a edu en Grafana."
ok "Usuarios vera y edu"

equipo="$(grafana_tls /api/teams -X POST --data '{"name":"equipo-pagos"}' | grep -o '"teamId":[0-9]*' | cut -d: -f2)"
[ -n "$equipo" ] || equipo="$(id_de "$(grafana_tls "/api/teams/search?name=equipo-pagos")")"
[ -n "$equipo" ] || paro "No pude crear el equipo equipo-pagos."
grafana_tls "/api/teams/$equipo/members" -X POST --data "{\"userId\":$edu}" >/dev/null
ok "Equipo equipo-pagos con edu"

carpeta="$(grafana_tls /api/folders -X POST --data "{\"title\":\"$CARPETA\"}" | grep -o '"uid":"[^"]*"' | head -n 1 | cut -d'"' -f4)"
[ -n "$carpeta" ] || paro "No pude crear la carpeta $CARPETA."
# Los permisos que se mandan reemplazan a todos los anteriores. Así salen los roles Viewer y Editor.
grafana_tls "/api/folders/$carpeta/permissions" -X POST \
  --data "{\"items\":[{\"teamId\":$equipo,\"permission\":2}]}" | grep -q 'Folder permissions updated' \
  || paro "No pude dejar los permisos de la carpeta $CARPETA."
sed "s/\"name\": \"host-use\"/\"name\": \"host-use\", \"annotations\": {\"grafana.app\/folder\": \"$carpeta\"}/" \
  "$RAIZ/Capitulo4/sin-internet/host-use.json" \
  | grafana_tls /apis/dashboard.grafana.app/v2/namespaces/default/dashboards -X POST --data-binary @- \
  | grep -q '"kind": *"Dashboard"' || paro "Grafana rechazó el dashboard Host · USE."
ok "Carpeta $CARPETA solo para equipo-pagos, con Host · USE"

# --- Cuenta de servicio y token revocado -----------------------------------------------------
cuenta="$(id_de "$(grafana_tls /api/serviceaccounts -X POST --data '{"name":"repartidor","role":"Viewer"}')")"
[ -n "$cuenta" ] || paro "No pude crear la cuenta de servicio repartidor."
respuesta="$(grafana_tls "/api/serviceaccounts/$cuenta/tokens" -X POST --data '{"name":"repartidor"}')"
printf '%s' "$respuesta" | grep -o '"key":"glsa_[^"]*"' | cut -d'"' -f4 > "$TRABAJO/token-repartidor"
grep -q '^glsa_' "$TRABAJO/token-repartidor" || paro "Grafana no entregó el token de repartidor."
grafana_tls "/api/serviceaccounts/$cuenta/tokens/$(id_de "$respuesta")" -X DELETE >/dev/null
ok "Token de repartidor en Capitulo7/trabajo/token-repartidor, ya revocado"

ok "Solución de la Práctica 7 aplicada"
