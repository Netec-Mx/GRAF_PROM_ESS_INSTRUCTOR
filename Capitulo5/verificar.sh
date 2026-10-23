#!/usr/bin/env bash
# Práctica 5. Revisa la métrica nueva de catalogo, las reglas de registro y de alerta, sus
# pruebas, Alertmanager, las notificaciones recibidas, Grafana Alerting y el dashboard.
set -u

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source-path=SCRIPTDIR source=../_comun/lib-practicas.sh
. "$AQUI/../_comun/lib-practicas.sh"

TITULO="Tianguis · Alertas"
PRUEBAS="infra/prometheus/pruebas/tianguis-alertas.test.yml"

# loki_cuenta CONSULTA  ->  cuántas líneas de las últimas 24 horas cumplen la consulta.
loki_cuenta() {
  local valor
  valor="$(curl -s --max-time 10 -G "http://localhost:$(leer_env PUERTO_LOKI)/loki/api/v1/query" \
    --data-urlencode "query=sum(count_over_time($1 [24h]))" | tr -d '\r\n' \
    | sed -n 's/.*"value":\[[0-9.]*,"\([0-9]*\)"\].*/\1/p')"
  echo "${valor:-0}"
}

# mailpit_cuenta BUSQUEDA  ->  cuántos correos de Mailpit cumplen la búsqueda.
mailpit_cuenta() {
  local valor
  valor="$(curl -s --max-time 10 -G "http://localhost:$(leer_env PUERTO_MAILPIT_UI)/api/v1/search" \
    --data-urlencode "query=$1" | tr -d '\r\n' | sed -n 's/.*"messages_count":\([0-9]*\).*/\1/p')"
  echo "${valor:-0}"
}

exigir_stack

echo "${NEGRITA}Parte A. Instrumentación y reglas de registro${NORMAL}"

if prom_existe 'catalog_product_views_total{ambiente="prod", category!=""}'; then
  paso_ok "catalogo publica catalog_product_views_total con la etiqueta category"
else
  paso_falla "Prometheus no tiene catalog_product_views_total con la etiqueta category" \
    "Agrega el counter en servicios/catalogo, corre bin/up.sh y abre algún producto con curl."
fi

if prom_existe 'catalog_product_views_total{sku!=""}'; then
  paso_falla "catalog_product_views_total tiene la etiqueta sku" \
    "Quita sku de las etiquetas del counter. Con un valor por producto crece sin límite."
else
  paso_ok "catalog_product_views_total no usa el sku como etiqueta"
fi

for regla in job:http_server_requests:rate5m job:http_server_errors:ratio_rate5m; do
  if prom_existe "$regla"; then
    paso_ok "La regla de registro $regla devuelve datos"
  else
    paso_falla "La regla de registro $regla no devuelve datos" \
      "Revisa infra/prometheus/rules/tianguis-registro.yml con promtool y recarga Prometheus."
  fi
done

echo
echo "${NEGRITA}Parte B. Alertas${NORMAL}"

reglas="$(curl -s --max-time 10 "$(prom_url)/api/v1/rules?type=alert" | tr -d '\r\n')"
for alerta in CatalogoCaido ErroresAltos ConciliacionSinExito; do
  if printf '%s\n' "$reglas" | grep -q "\"name\":\"$alerta\""; then
    paso_ok "Prometheus tiene cargada la alerta $alerta"
  else
    paso_falla "Prometheus no tiene la alerta $alerta" \
      "Revisa infra/prometheus/rules/tianguis-alertas.yml con promtool y recarga Prometheus."
  fi
done

if [ ! -f "$RAIZ/$PRUEBAS" ]; then
  paso_falla "No existe $PRUEBAS" "Créalo con las pruebas de las tres alertas."
elif MSYS_NO_PATHCONV=1 docker exec gpe-prometheus promtool test rules \
  /etc/prometheus/pruebas/tianguis-alertas.test.yml >/dev/null 2>&1; then
  paso_ok "promtool test rules pasa con $PRUEBAS"
else
  paso_falla "promtool test rules falla con $PRUEBAS" \
    "Córrelo a mano con docker exec para ver qué prueba no pasa."
fi

estado_am="$(curl -s --max-time 10 "http://localhost:$(leer_env PUERTO_ALERTMANAGER)/api/v2/status" | tr -d '\r\n')"
if printf '%s\n' "$estado_am" | grep -q 'inhibit_rules' \
  && printf '%s\n' "$estado_am" | grep -q 'CatalogoCaido' \
  && printf '%s\n' "$estado_am" | grep -q 'ErroresAltos'; then
  paso_ok "Alertmanager tiene cargada la inhibición de ErroresAltos por CatalogoCaido"
else
  paso_falla "Alertmanager no tiene la inhibición cargada" \
    "Agrégala en infra/alertmanager/alertmanager.yml, revisa con amtool y recarga Alertmanager."
fi

for estado in firing resolved; do
  n="$(loki_cuenta "{compose_service=\"webhook\"} |= \`\"receiver\":\"tienda-webhook\"\` |= \`\"status\":\"$estado\"\`")"
  if [ "$n" -gt 0 ]; then
    paso_ok "gpe-webhook recibió $n notificaciones $estado de Alertmanager"
  else
    paso_falla "gpe-webhook no recibió ninguna notificación $estado de Alertmanager" \
      "Revisa el receptor tienda-webhook y repite el incidente del paso 9."
  fi
done

n="$(mailpit_cuenta "from:alertmanager@tianguis.local")"
if [ "$n" -gt 0 ]; then
  paso_ok "Mailpit tiene $n correos de Alertmanager"
else
  paso_falla "Mailpit no tiene correos de Alertmanager" \
    "Revisa el receptor guardia-correo y la ruta que lleva las alertas hacia él."
fi

echo
echo "${NEGRITA}Grafana Alerting y dashboard${NORMAL}"

reglas_grafana="$(grafana_api /api/v1/provisioning/alert-rules)"
if printf '%s\n' "$reglas_grafana" | grep -q 'histogram_quantile' \
  && printf '%s\n' "$reglas_grafana" | grep -q 'job=\\"pagos\\"'; then
  paso_ok "Grafana tiene una regla sobre el p95 de pagos"
else
  paso_falla "Grafana no tiene una regla sobre el p95 de pagos" \
    "Créala en Alerting, Alert rules, con la consulta de la guía."
fi

if grafana_api /api/v1/provisioning/templates | grep -q '"name":"tianguis-resumen"'; then
  paso_ok "Grafana tiene la plantilla de notificación tianguis-resumen"
else
  paso_falla "Grafana no tiene la plantilla tianguis-resumen" \
    "Créala en Alerting, Contact points, pestaña Notification Templates."
fi

if uid="$(grafana_dashboard_existe "$TITULO")"; then
  paso_ok "Existe el dashboard $TITULO"
  json="$(grafana_dashboard_json "$uid")"
  if printf '%s\n' "$json" | grep -q '"annotations":{"list":\[.*chaos_active'; then
    paso_ok "El dashboard tiene una anotación a partir de chaos_active"
  else
    paso_falla "El dashboard no tiene una anotación con chaos_active" \
      "Agrégala en Settings, Annotations, con la consulta de la guía."
  fi
  if printf '%s\n' "$json" | grep -q '"type":"alertlist"'; then
    paso_ok "El dashboard tiene un panel Alert list"
  else
    paso_falla "El dashboard no tiene un panel Alert list" "Agrégalo con Add panel y elige Alert list."
  fi
else
  paso_falla "No existe el dashboard $TITULO" "Guárdalo con ese nombre exacto."
fi

echo
echo "${NEGRITA}Todo de vuelta a la normalidad${NORMAL}"

if [ "$(contenedor_estado gpe-catalogo)" = "running" ]; then
  paso_ok "gpe-catalogo está corriendo"
else
  paso_falla "gpe-catalogo no está corriendo" "Levántalo con docker start gpe-catalogo."
fi

if prom_existe 'sum(chaos_active) == 0'; then
  paso_ok "No queda ninguna falla de caos encendida"
else
  paso_falla "Queda una falla de caos encendida" "Apágalas con bin/caos.sh apagar."
fi

resumen
