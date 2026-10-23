#!/usr/bin/env bash
# Práctica 5, solución. Copia los archivos resueltos con la misma ruta que tienen en el repositorio,
# reconstruye catalogo y recarga Prometheus y Alertmanager. Repite el incidente con una caída de
# catalogo para que lleguen notificaciones firing y resolved, y crea en Grafana la plantilla, el
# punto de contacto, la política, la regla PagosLentos y el dashboard Tianguis · Alertas.
# Tarda unos 5 minutos por los tiempos reales de las alertas. Pide escribir SI. Sin SI no toca nada.
set -u

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source-path=SCRIPTDIR source=../../_comun/lib-practicas.sh
. "$AQUI/../../_comun/lib-practicas.sh"

ARCHIVOS="servicios/catalogo/src/catalogo/metricas.py
servicios/catalogo/src/catalogo/api/rutas.py
infra/prometheus/rules/tianguis-registro.yml
infra/prometheus/rules/tianguis-alertas.yml
infra/prometheus/pruebas/tianguis-alertas.test.yml
infra/alertmanager/alertmanager.yml"
CARPETA="tianguis"
TITULO="Tianguis · Alertas"
P95_PAGOS='histogram_quantile(0.95, sum by (le) (rate(http_server_request_duration_seconds_bucket{job=\"pagos\", http_route=\"/pagos\"}[5m])))'

# loki_cuenta CONSULTA  ->  cuántas líneas cumplen la consulta desde que empezó este script. Las
# notificaciones de una corrida anterior no cuentan.
loki_cuenta() {
  local valor ventana=$(( $(date +%s) - INICIO + 1 ))
  valor="$(curl -s --max-time 10 -G "http://localhost:$(leer_env PUERTO_LOKI)/loki/api/v1/query" \
    --data-urlencode "query=sum(count_over_time($1 [${ventana}s]))" | tr -d '\r\n' \
    | sed -n 's/.*"value":\[[0-9.]*,"\([0-9]*\)"\].*/\1/p')"
  echo "${valor:-0}"
}

# en_webhook ESTADO  ->  0 si gpe-webhook ya recibió una notificación de CatalogoCaido en ESTADO.
en_webhook() {
  [ "$(loki_cuenta "{compose_service=\"webhook\"} |= \`\"receiver\":\"tienda-webhook\"\` |= \`\"status\":\"$1\"\` |= \`CatalogoCaido\`")" -gt 0 ]
}

# Lo que se crea por la API de provisioning queda editable en la interfaz con esta cabecera.
grafana_alerting() {
  grafana_api "$@" -H 'Content-Type: application/json' -H 'X-Disable-Provenance: true'
}

exigir_stack
confirmar_cambios 5 "LOS ARCHIVOS DE CATALOGO, LAS REGLAS, SUS PRUEBAS Y ALERTMANAGER.YML" \
  "SE REEMPLAZAN CON LOS RESUELTOS. EN GRAFANA SE REEMPLAZAN LA PLANTILLA," \
  "EL PUNTO DE CONTACTO, LA POLÍTICA, LA REGLA PAGOSLENTOS Y EL DASHBOARD"
INICIO=$(date +%s)

# --- Archivos ---------------------------------------------------------------------------------
# Cada archivo de infra se espera hasta que su contenedor lo vea. El código de catalogo se copia
# sin esperar porque entra con la imagen nueva.
for archivo in $ARCHIVOS; do
  case "$archivo" in
    infra/prometheus/*)   copiar_adentro "$AQUI/$archivo" "$RAIZ/$archivo" gpe-prometheus "/etc/prometheus/${archivo#infra/prometheus/}" ;;
    infra/alertmanager/*) copiar_adentro "$AQUI/$archivo" "$RAIZ/$archivo" gpe-alertmanager "/etc/alertmanager/${archivo#infra/alertmanager/}" ;;
    *) mkdir -p "$(dirname "$RAIZ/$archivo")"; cp "$AQUI/$archivo" "$RAIZ/$archivo" || paro "No pude copiar $archivo." ;;
  esac
done
ok "Archivos resueltos copiados"

info "Reconstruyendo catalogo con el counter nuevo"
"$RAIZ/bin/up.sh" >/dev/null 2>&1 || paro "bin/up.sh falló. Córrelo a mano para ver el mensaje."
for sku in TNG-0001 TNG-0007 TNG-0013 TNG-0019; do
  curl -s -o /dev/null --max-time 10 "http://localhost:$(leer_env PUERTO_CATALOGO)/productos/$sku"
done
esperar_hasta 180 "catalog_product_views_total en Prometheus" \
  prom_existe 'catalog_product_views_total{ambiente="prod", category!=""}'
ok "catalogo publica catalog_product_views_total"

MSYS_NO_PATHCONV=1 docker exec gpe-prometheus promtool check rules \
  /etc/prometheus/rules/tianguis-registro.yml /etc/prometheus/rules/tianguis-alertas.yml >/dev/null 2>&1 \
  || paro "promtool rechaza las reglas de la solución."
MSYS_NO_PATHCONV=1 docker exec gpe-alertmanager amtool check-config /etc/alertmanager/alertmanager.yml >/dev/null 2>&1 \
  || paro "amtool rechaza el alertmanager.yml de la solución."
docker exec gpe-prometheus kill -HUP 1 || paro "No pude recargar Prometheus."
curl -s -o /dev/null --max-time 10 -X POST "http://localhost:$(leer_env PUERTO_ALERTMANAGER)/-/reload" \
  || paro "No pude recargar Alertmanager."
esperar_hasta 120 "las reglas de registro" prom_existe 'job:http_server_errors:ratio_rate5m'
ok "Prometheus y Alertmanager recargados con las reglas y el ruteo"

# --- Incidente -------------------------------------------------------------------------------
info "Deteniendo gpe-catalogo para que suene CatalogoCaido"
docker stop gpe-catalogo >/dev/null || paro "No pude detener gpe-catalogo."
esperar_hasta 300 "la notificación firing de CatalogoCaido en gpe-webhook" en_webhook firing
ok "CatalogoCaido llegó a gpe-webhook"
"$RAIZ/bin/up.sh" >/dev/null 2>&1 || paro "bin/up.sh falló. Córrelo a mano para ver el mensaje."
esperar_hasta 420 "la notificación resolved de CatalogoCaido en gpe-webhook" en_webhook resolved
ok "CatalogoCaido se resolvió"
# catalogo volvió con el counter en cero y sin series, que aparecen con la primera visita a un producto.
esperar_hasta 180 "catalog_product_views_total después de reiniciar catalogo" \
  prom_existe 'catalog_product_views_total{ambiente="prod", category!=""}'

# --- Grafana Alerting ------------------------------------------------------------------------
grafana_alerting /api/v1/provisioning/templates/tianguis-resumen -X PUT --data @- >/dev/null <<'FIN'
{"template":"{{ define \"tianguis.resumen\" }}\n{{ range .Alerts }}[{{ .Status }}] {{ .Labels.alertname }}\n{{ .Annotations.summary }}\nDesde las {{ .StartsAt.Format \"15:04:05\" }} UTC\n{{ end }}\n{{ end }}"}
FIN
grafana_api /api/v1/provisioning/templates | grep -q '"name":"tianguis-resumen"' || paro "Grafana no guardó la plantilla."
ok "Plantilla tianguis-resumen"

for uid in $(grafana_api /api/v1/provisioning/contact-points | grep -o '"uid":"[^"]*","name":"equipo-pagos"' | cut -d'"' -f4); do
  grafana_api "/api/v1/provisioning/contact-points/$uid" -X DELETE >/dev/null
done
grafana_alerting /api/v1/provisioning/contact-points -X POST --data @- >/dev/null <<'FIN'
{"name":"equipo-pagos","type":"email","settings":{"addresses":"pagos@tianguis.local","message":"{{ template \"tianguis.resumen\" . }}"}}
FIN
grafana_alerting /api/v1/provisioning/contact-points -X POST --data @- >/dev/null <<'FIN'
{"name":"equipo-pagos","type":"webhook","settings":{"url":"http://webhook:8080/grafana"}}
FIN
raiz_politica="$(grafana_api /api/v1/provisioning/policies | sed -n 's/^{"receiver":"\([^"]*\)".*/\1/p')"
grafana_alerting /api/v1/provisioning/policies -X PUT --data @- >/dev/null <<FIN
{"receiver":"${raiz_politica:-empty}","group_by":["grafana_folder","alertname"],"routes":[{"receiver":"equipo-pagos","object_matchers":[["team","=","pagos"]]}]}
FIN
ok "Punto de contacto equipo-pagos y política team=pagos"

grafana_api "/api/folders/$CARPETA" | grep -q "\"uid\":\"$CARPETA\"" \
  || grafana_api /api/folders -X POST -H 'Content-Type: application/json' \
    --data "{\"uid\":\"$CARPETA\",\"title\":\"Tianguis\"}" >/dev/null
for uid in $(grafana_api /api/v1/provisioning/alert-rules | grep -o '"uid":"[^"]*","orgID":[0-9]*,"folderUID":"[^"]*","ruleGroup":"pagos"' | cut -d'"' -f4); do
  grafana_api "/api/v1/provisioning/alert-rules/$uid" -X DELETE >/dev/null
done
grafana_alerting /api/v1/provisioning/alert-rules -X POST --data @- >/dev/null <<FIN
{"title":"PagosLentos","ruleGroup":"pagos","folderUID":"$CARPETA","condition":"C","for":"1m",
 "noDataState":"NoData","execErrState":"Error",
 "labels":{"team":"pagos","severity":"advertencia"},
 "annotations":{"summary":"El p95 de pagos está en {{ printf \"%.2f\" \$values.A.Value }} segundos"},
 "data":[
  {"refId":"A","relativeTimeRange":{"from":600,"to":0},"datasourceUid":"prometheus",
   "model":{"refId":"A","expr":"$P95_PAGOS","instant":true}},
  {"refId":"C","datasourceUid":"__expr__",
   "model":{"refId":"C","type":"threshold","expression":"A","conditions":[{"evaluator":{"type":"gt","params":[1]}}]}}]}
FIN
grafana_api /api/v1/provisioning/alert-rules | grep -q '"title":"PagosLentos"' || paro "Grafana no guardó la regla PagosLentos."
ok "Regla PagosLentos en la carpeta Tianguis"

# --- Dashboard -------------------------------------------------------------------------------
while uid="$(grafana_dashboard_existe "$TITULO")"; do
  grafana_api "/api/dashboards/uid/$uid" -X DELETE >/dev/null
done
grafana_api /api/dashboards/db -X POST -H 'Content-Type: application/json' --data @- >/dev/null <<FIN
{"overwrite":true,"dashboard":{"title":"$TITULO","time":{"from":"now-1h","to":"now"},
 "annotations":{"list":[{"name":"Caos","enable":true,"iconColor":"red",
  "datasource":{"type":"prometheus","uid":"prometheus"},
  "expr":"max by (job, type) (chaos_active) > 0","titleFormat":"Caos en {{job}}","textFormat":"Falla {{type}}"}]},
 "panels":[
  {"type":"timeseries","title":"Proporción de errores en prod","gridPos":{"x":0,"y":0,"w":12,"h":8},
   "datasource":{"type":"prometheus","uid":"prometheus"},
   "targets":[{"refId":"A","expr":"job:http_server_errors:ratio_rate5m"}]},
  {"type":"alertlist","title":"Alertas activas","gridPos":{"x":12,"y":0,"w":12,"h":8}}]}}
FIN
grafana_dashboard_existe "$TITULO" >/dev/null || paro "Grafana no guardó el dashboard $TITULO."
ok "Dashboard $TITULO"

ok "Solución de la Práctica 5 aplicada"
