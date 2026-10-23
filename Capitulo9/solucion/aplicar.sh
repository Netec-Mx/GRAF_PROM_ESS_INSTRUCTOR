#!/usr/bin/env bash
# Práctica 9, solución. Hace la Parte A completa sobre el stack base. Respalda los dashboards,
# levanta la capa de escala, los importa en Grafana sobre PostgreSQL, crea la organización, el
# equipo y la carpeta, copia los archivos resueltos de Prometheus y del borde, agrega el datasource
# de Mimir y pide una revisión a Advisor. Después corre El Buen Fin, escribe el diagnóstico con un
# pago lento real, apaga las fallas y espera a que las alertas se resuelvan. Tarda unos 15 minutos.
# Pide escribir SI. Sin SI no toca nada.
set -u

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source-path=SCRIPTDIR source=../../_comun/lib-practicas.sh
. "$AQUI/../../_comun/lib-practicas.sh"

CAPITULO="$RAIZ/Capitulo9"
RESPALDO="$CAPITULO/respaldo"
PORTAL="http://localhost:8088"
CAPA_SANA="gpe-nginx gpe-postgres gpe-grafana gpe-grafana-2 gpe-prometheus gpe-prometheus-borde gpe-mimir"
TRAZA_EJEMPLO="2558a4ab7a120231c0d2aee48b0ce98b"

# portal RUTA [opciones de curl]  ->  API de Grafana a través de nginx, como admin.
portal() {
  local ruta="$1"
  shift
  curl -s --max-time 15 -u "$(leer_env GRAFANA_ADMIN_USER):$(leer_env GRAFANA_ADMIN_PASSWORD)" \
    -H 'Content-Type: application/json' "$@" "$PORTAL/grafana$ruta" | tr -d '\r\n'
}

# hay URL CONSULTA  ->  0 si la consulta devuelve al menos una serie en ese Prometheus.
hay() {
  curl -s --max-time 10 -G "$1/api/v1/query" --data-urlencode "query=$2" | grep -q '"value":\['
}

capa_sana() {
  local c
  for c in $CAPA_SANA; do
    [ "$(contenedor_salud "$c")" = "healthy" ] || return 1
  done
}

mimir_tiene_catalogo() {
  portal /api/datasources/proxy/uid/mimir/api/v1/query -G --data-urlencode 'query=up{job="catalogo"}' | grep -q '"value":\['
}

# traza_lenta  ->  el trace_id de un pago de los últimos 15 minutos con pasarela.cobrar sobre 2 s.
traza_lenta() {
  local ahora
  ahora="$(date +%s)"
  curl -s --max-time 15 -G "http://localhost:$(leer_env PUERTO_TEMPO)/api/search" \
    --data-urlencode 'q={ name = "pasarela.cobrar" && duration > 2s }' \
    --data-urlencode "start=$((ahora - 900))" --data-urlencode "end=$ahora" --data-urlencode "limit=20" \
    | tr -d '\r\n' | grep -o '"traceID":"[0-9a-f]\{32\}"' | head -n 1 | cut -d'"' -f4
}
hay_traza_lenta() { [ -n "$(traza_lenta)" ]; }

alertas_sonando() {
  local n
  n="$(curl -s --max-time 10 -G "$PORTAL/prometheus/api/v1/query" \
    --data-urlencode 'query=count(ALERTS{alertstate="firing", alertname=~"ErroresAltos|LatenciaAlta|PagosLentos"})' \
    | sed -n 's/.*"value":\[[0-9.]*,"\([0-9]*\)"\].*/\1/p')"
  [ "${n:-0}" -ge 3 ]
}
alertas_resueltas() {
  ! hay "$PORTAL/prometheus" 'count(ALERTS{alertname=~"ErroresAltos|LatenciaAlta|PagosLentos"})'
}

chequear_docker
[ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "http://localhost:$(leer_env PUERTO_GRAFANA)/api/health")" = "200" ] \
  || paro "Grafana no responde en su puerto. La solución parte del stack base. Corre Capitulo9/restaurar.sh."
confirmar_cambios 9 "LOS ARCHIVOS DE CAPITULO9 SE REEMPLAZAN CON LOS RESUELTOS" \
  "SE LEVANTA LA CAPA DE ESCALA Y CORRE EL BUEN FIN COMPLETO"

# --- Base de datos y réplicas ----------------------------------------------------------------
rm -rf "$RESPALDO"
mkdir -p "$RESPALDO"
for uid in $(grafana_api "/api/search?type=dash-db" | grep -o '"uid":"[^"]*"' | cut -d'"' -f4); do
  grafana_api "/api/dashboards/uid/$uid" > "$RESPALDO/$uid.json"
done
ls "$RESPALDO"/*.json >/dev/null 2>&1 || paro "Grafana no tiene dashboards que respaldar."
ok "Dashboards respaldados en Capitulo9/respaldo"

cp "$CAPITULO/secretos/postgres.ejemplo" "$CAPITULO/secretos/postgres" \
  || paro "No pude crear Capitulo9/secretos/postgres."
ok "Clave de PostgreSQL en Capitulo9/secretos/postgres"

info "Levantando la capa de escala"
docker compose -p gpe --env-file "$ENV_FILE" -f "$COMPOSE_FILE" -f "$CAPITULO/compose.escala.yaml" up -d >/dev/null 2>&1 \
  || paro "docker compose no pudo levantar la capa de escala."
esperar_hasta 300 "la capa de escala healthy" capa_sana
ok "Capa de escala arriba"

for archivo in "$RESPALDO"/*.json; do
  portal /api/dashboards/db -X POST -d @"$archivo" | grep -q '"status":"success"' \
    || paro "Grafana sobre PostgreSQL rechazó $(basename "$archivo")."
done
ok "Respaldo importado en Grafana sobre PostgreSQL"

# --- Organizaciones, equipos y carpetas ------------------------------------------------------
portal /api/orgs -X POST -d '{"name":"Sindicato de Fruteros"}' >/dev/null
equipo="$(portal /api/teams -X POST -d '{"name":"equipo-lacteos"}' | grep -o '"teamId":[0-9]*' | cut -d: -f2)"
portal /api/folders -X POST -d '{"uid":"lacteos","title":"L\u00e1cteos"}' >/dev/null
[ -n "$equipo" ] && portal /api/folders/lacteos/permissions -X POST \
  -d "{\"items\":[{\"teamId\":$equipo,\"permission\":2}]}" >/dev/null
ok "Organización Sindicato de Fruteros, equipo equipo-lacteos y carpeta Lácteos"

# --- Descubrimiento, federación y escritura remota -------------------------------------------
mkdir -p "$CAPITULO/prometheus/destinos"
cp "$AQUI/prometheus/destinos/catalogo.yml" "$AQUI/prometheus/destinos/pedidos.yml" "$CAPITULO/prometheus/destinos/" \
  || paro "No pude copiar los archivos de destinos."
copiar_adentro "$AQUI/prometheus/prometheus.yml" "$CAPITULO/prometheus/prometheus.yml" \
  gpe-prometheus /etc/prometheus-escala/prometheus.yml
MSYS_NO_PATHCONV=1 docker exec gpe-prometheus promtool check config /etc/prometheus-escala/prometheus.yml >/dev/null 2>&1 \
  || paro "promtool rechaza el prometheus.yml de la solución."
docker exec gpe-prometheus kill -HUP 1 || paro "No pude recargar Prometheus."
copiar_adentro "$AQUI/borde/prometheus.yml" "$CAPITULO/borde/prometheus.yml" \
  gpe-prometheus-borde /etc/prometheus/prometheus.yml
docker exec gpe-prometheus-borde kill -HUP 1 || paro "No pude recargar el Prometheus de borde."
ok "Prometheus y el borde recargados con la configuración resuelta"

portal /api/datasources -X POST \
  -d '{"name":"Mimir","uid":"mimir","type":"prometheus","access":"proxy","url":"http://mimir:9009/prometheus","jsonData":{"httpMethod":"POST","prometheusType":"Mimir"}}' >/dev/null
esperar_hasta 120 "los destinos descubiertos por HTTP" hay "$PORTAL/prometheus" 'up{job="descubierto-por-http"} == 1'
esperar_hasta 120 "la federación en el borde" hay "$PORTAL/borde" 'up{job="federacion"} == 1'
esperar_hasta 120 "las muestras enviadas a Mimir" hay "$PORTAL/prometheus" 'prometheus_remote_storage_samples_total{remote_name="mimir"} > 0'
esperar_hasta 180 "la serie up de catalogo en Mimir" mimir_tiene_catalogo
esperar_hasta 120 "el job loki arriba con su cupo" hay "$PORTAL/prometheus" 'up{job="loki"} == 1'
ok "Descubrimiento, federación y Mimir funcionando"

# --- Grafana Advisor -------------------------------------------------------------------------
for tipo in $(portal /apis/advisor.grafana.app/v0alpha1/namespaces/default/checktypes \
  | grep -o '"metadata": *{ *"name": *"[^"]*"' | sed 's/.*"\([^"]*\)"$/\1/'); do
  portal /apis/advisor.grafana.app/v0alpha1/namespaces/default/checks -X POST \
    -d "{\"kind\":\"Check\",\"apiVersion\":\"advisor.grafana.app/v0alpha1\",\"metadata\":{\"generateName\":\"check-\",\"labels\":{\"advisor.grafana.app/type\":\"$tipo\"}},\"spec\":{}}" >/dev/null
done
portal /apis/advisor.grafana.app/v0alpha1/namespaces/default/checks | grep -q '"kind": *"Check"' \
  || paro "Advisor no registró ninguna revisión."
ok "Advisor revisó la instancia"

# --- Parte B. El Buen Fin --------------------------------------------------------------------
"$CAPITULO/preparar-buenfin.sh" >/dev/null || paro "Capitulo9/preparar-buenfin.sh falló."
info "Empezó El Buen Fin. Esperando que suenen las tres alertas"
esperar_hasta 600 "las alertas de El Buen Fin" alertas_sonando
esperar_hasta 300 "un pago lento en Tempo" hay_traza_lenta
sed "s/$TRAZA_EJEMPLO/$(traza_lenta)/" "$AQUI/diagnostico.md" > "$CAPITULO/diagnostico.md" \
  || paro "No pude escribir Capitulo9/diagnostico.md."
ok "Diagnóstico escrito con un pago lento real"

"$RAIZ/bin/caos.sh" apagar >/dev/null || paro "No pude apagar las fallas de caos."
"$RAIZ/bin/trafico.sh" nivel normal >/dev/null || paro "No pude dejar el tráfico en nivel normal."
info "Fallas apagadas. Esperando que se resuelvan las alertas"
esperar_hasta 900 "que se resuelvan las alertas de El Buen Fin" alertas_resueltas
ok "Solución de la Práctica 9 aplicada"
