#!/usr/bin/env bash
# Práctica 8, solución. Copia la configuración resuelta de Alloy y de Loki con la regla del ruler,
# recarga Alloy, reinicia Loki, manda la línea del refrigerador por OTLP y copia las consultas
# resueltas. Espera a que la alerta CatalogoErroresEnLogs suene, apaga la falla de catalogo y
# espera el resuelto. Tarda unos 10 minutos. Pide escribir SI. Sin SI no toca nada.
set -u

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source-path=SCRIPTDIR source=../../_comun/lib-practicas.sh
. "$AQUI/../../_comun/lib-practicas.sh"

ARCHIVOS="infra/alloy/config.alloy
infra/loki/loki.yaml
infra/loki/reglas/fake/tianguis-logs.yaml"
ALERTA="CatalogoErroresEnLogs"
LOKI="http://localhost:$(leer_env PUERTO_LOKI)"

# en_webhook ESTADO  ->  0 si gpe-webhook recibió la alerta de logs en ESTADO desde que empezó este
# script, según Loki. Las notificaciones de una corrida anterior no cuentan.
en_webhook() {
  local ventana=$(( $(date +%s) - INICIO + 1 ))
  curl -s --max-time 15 -G "$LOKI/loki/api/v1/query" \
    --data-urlencode "query=sum(count_over_time({compose_service=\"webhook\"} |= \`\"alertnames\":\"$ALERTA\"\` |= \`\"status\":\"$1\"\` [${ventana}s]))" \
    | tr -d '\r\n' | grep -q '"value":\['
}

# con_level  ->  0 si catalogo ya escribió líneas con la etiqueta level en los últimos 2 minutos.
con_level() {
  curl -s --max-time 15 -G "$LOKI/loki/api/v1/series" --data-urlencode 'match[]={compose_service="catalogo", level=~".+"}' \
    --data-urlencode "start=$(( $(date +%s) - 120 ))000000000" | tr -d '\r\n' | grep -q '"level"'
}

loki_sano() {
  [ "$(contenedor_salud gpe-loki)" = "healthy" ] && curl -s --max-time 10 "$LOKI/loki/api/v1/rules" | grep -q "alert: $ALERTA"
}

exigir_stack
confirmar_cambios 8 "INFRA/ALLOY/CONFIG.ALLOY, INFRA/LOKI/LOKI.YAML Y LA REGLA DEL RULER" \
  "SE REEMPLAZAN CON LOS RESUELTOS. CAPITULO8/CONSULTAS.MD TAMBIÉN"
INICIO=$(date +%s)

# Alloy se recarga en caliente, así que se espera a que vea su archivo nuevo. Loki se reinicia y
# no trae cat para comparar, el reinicio le da tiempo al archivo de llegar.
for archivo in $ARCHIVOS; do
  case "$archivo" in
    infra/alloy/*) copiar_adentro "$AQUI/$archivo" "$RAIZ/$archivo" gpe-alloy "/etc/alloy/${archivo#infra/alloy/}" ;;
    *) mkdir -p "$(dirname "$RAIZ/$archivo")"; cp "$AQUI/$archivo" "$RAIZ/$archivo" || paro "No pude copiar $archivo." ;;
  esac
done
cp "$AQUI/consultas.md" "$RAIZ/Capitulo8/consultas.md" || paro "No pude copiar consultas.md."
ok "Archivos resueltos copiados"

MSYS_NO_PATHCONV=1 docker exec gpe-alloy alloy validate /etc/alloy/config.alloy >/dev/null 2>&1 \
  || paro "Alloy rechaza el config.alloy de la solución."
curl -s -o /dev/null --max-time 10 -X POST "http://localhost:$(leer_env PUERTO_ALLOY)/-/reload" || paro "No pude recargar Alloy."
docker restart gpe-loki >/dev/null || paro "No pude reiniciar Loki."
esperar_hasta 180 "Loki healthy con la regla $ALERTA" loki_sano
ok "Alloy recargado y Loki con el ruler"

# Una línea de healthcheck para que Alloy descarte al menos una.
docker exec gpe-catalogo sh -c 'echo "{\"level\": \"info\", \"service\": \"catalogo\", \"route\": \"/salud\", \"status\": 200, \"msg\": \"healthcheck de prueba\"}" > /proc/1/fd/1'
curl -s -o /dev/null --max-time 10 -X POST "$LOKI/otlp/v1/logs" -H 'Content-Type: application/json' \
  -d '{"resourceLogs":[{"resource":{"attributes":[{"key":"service.name","value":{"stringValue":"refrigerador"}}]},"scopeLogs":[{"logRecords":[{"timeUnixNano":"'"$(date +%s)"'000000000","severityText":"WARN","body":{"stringValue":"la puerta del refrigerador qued\u00f3 abierta"},"attributes":[{"key":"pasillo","value":{"stringValue":"3"}},{"key":"temperatura","value":{"doubleValue":9.5}}]}]}]}]}' \
  || paro "Loki no recibió la línea por OTLP."
esperar_hasta 180 "líneas de catalogo con la etiqueta level" con_level
ok "Loki recibe level como etiqueta y la línea del refrigerador"

info "Esperando que suene $ALERTA. Tarda unos 4 minutos"
esperar_hasta 600 "la notificación firing de $ALERTA en gpe-webhook" en_webhook firing
ok "$ALERTA llegó a gpe-webhook"
"$RAIZ/bin/caos.sh" apagar >/dev/null || paro "No pude apagar las fallas de caos."
info "Falla de catalogo apagada. Esperando el resuelto"
esperar_hasta 900 "la notificación resolved de $ALERTA en gpe-webhook" en_webhook resolved
ok "Solución de la Práctica 8 aplicada"
