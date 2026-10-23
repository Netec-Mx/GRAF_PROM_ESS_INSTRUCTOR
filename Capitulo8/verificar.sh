#!/usr/bin/env bash
# Práctica 8. Revisa el pipeline de Alloy, las etiquetas y metadatos en Loki, la línea enviada
# por OTLP, las consultas de Capitulo8/consultas.md, la regla del ruler y sus notificaciones.
set -u

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source-path=SCRIPTDIR source=../_comun/lib-practicas.sh
. "$AQUI/../_comun/lib-practicas.sh"

ALLOY_CONFIG="$RAIZ/infra/alloy/config.alloy"
CONSULTAS="$AQUI/consultas.md"
ALERTA="CatalogoErroresEnLogs"

# Lo que debe usar cada consulta, en orden. Texto que busca grep y explicación para la pista.
REQUISITOS='1|!=|un filtro de línea con != o |=
2|json|el parser json y un filtro por status
3|line_format|line_format
4|count_over_time|count_over_time
5|rate(|rate
6|by (status)|sum by (status)
7|unwrap|quantile_over_time con unwrap duration_ms
8|trace_id|el metadato trace_id'

loki_url() { echo "http://localhost:$(leer_env PUERTO_LOKI)"; }

# loki_lineas CONSULTA [SEGUNDOS]  ->  cuántas líneas devuelve una consulta de logs en ese plazo.
loki_lineas() {
  local desde=$(( $(date +%s) - ${2:-900} ))
  curl -s --max-time 15 -G "$(loki_url)/loki/api/v1/query_range" --data-urlencode "query=$1" \
    --data-urlencode "start=${desde}000000000" --data-urlencode "limit=50" | tr -d '\r\n' \
    | grep -o '"values":\[\["[0-9]*"' | grep -c values
}

# loki_valores CONSULTA  ->  cuántas series devuelve una consulta de métrica en los últimos 30
# minutos. Mira un rango y no el instante, porque la falla de catalogo ya está apagada al final.
loki_valores() {
  local desde=$(( $(date +%s) - 1800 ))
  curl -s --max-time 15 -G "$(loki_url)/loki/api/v1/query_range" --data-urlencode "query=$1" \
    --data-urlencode "start=${desde}000000000" --data-urlencode "step=60" | tr -d '\r\n' \
    | grep -o '"values":\[\[' | grep -c values
}

# consulta N  ->  la consulta del bloque logql de la pregunta N, en una sola línea.
consulta() {
  awk -v n="$1" '
    /^## / { actual = $2; sub(/\./, "", actual) }
    /^```logql/ { if (actual == n) { dentro = 1; next } }
    /^```/ { dentro = 0 }
    dentro { printf "%s ", $0 }
  ' "$CONSULTAS" | sed 's/ *$//'
}

exigir_stack

echo "${NEGRITA}Pipeline de Alloy${NORMAL}"

if grep -q 'stage.drop' "$ALLOY_CONFIG" && grep -q 'salud' "$ALLOY_CONFIG" \
  && prom_existe 'sum(loki_process_dropped_lines_total{reason="healthcheck"}) > 0'; then
  paso_ok "Alloy descarta las líneas de healthcheck y ya descartó al menos una"
else
  paso_falla "Alloy no descartó ninguna línea de healthcheck" \
    "Agrega stage.drop con drop_counter_reason healthcheck, recarga Alloy y repite la línea de prueba."
fi

ahora=$(date +%s)
etiquetas="$(curl -s --max-time 10 "$(loki_url)/loki/api/v1/labels?start=$((ahora - 600))000000000" | tr -d '\r\n')"
if grep -q 'stage.labels' "$ALLOY_CONFIG" && printf '%s\n' "$etiquetas" | grep -q '"level"'; then
  paso_ok "level es una etiqueta de Loki"
else
  paso_falla "level no es una etiqueta de Loki" "Agrega stage.json y stage.labels con level, y recarga Alloy."
fi

if printf '%s\n' "$etiquetas" | grep -q '"trace_id"'; then
  paso_falla "trace_id quedó como etiqueta de Loki" "Sácalo de stage.labels y déjalo en stage.structured_metadata."
elif grep -q 'stage.structured_metadata' "$ALLOY_CONFIG" \
  && [ "$(loki_lineas '{compose_service="pagos"} | trace_id != ""' 600)" -gt 0 ]; then
  paso_ok "trace_id no es etiqueta y se consulta como metadato estructurado"
else
  paso_falla "No hay líneas de pagos con el metadato trace_id" "Agrega stage.structured_metadata con trace_id y recarga Alloy."
fi

echo
echo "${NEGRITA}Ingesta por OTLP${NORMAL}"

if [ "$(loki_lineas '{service_name="refrigerador"} | pasillo="3"' 86400)" -gt 0 ]; then
  paso_ok "Loki tiene la línea enviada por OTLP con su atributo pasillo"
else
  paso_falla "Loki no tiene la línea del refrigerador enviada por OTLP" "Repite el curl a /otlp/v1/logs de la guía."
fi

echo
echo "${NEGRITA}Consultas de Capitulo8/consultas.md${NORMAL}"

if [ ! -f "$CONSULTAS" ]; then
  paso_falla "No existe Capitulo8/consultas.md" "Recupéralo con git checkout -- Capitulo8/consultas.md."
else
  while IFS='|' read -r n requisito explicacion; do
    q="$(consulta "$n")"
    if [ -z "$q" ]; then
      paso_falla "La consulta $n está vacía" "Cópiala en su bloque de Capitulo8/consultas.md."
      continue
    fi
    if ! printf '%s' "$q" | grep -q -F -- "$requisito"; then
      paso_falla "La consulta $n no usa $explicacion" "Revisa qué pide la pregunta $n."
      continue
    fi
    case "$q" in
      sum*|count*|quantile*|rate*|avg*|max*|min*|topk*) datos="$(loki_valores "$q")" ;;
      *) datos="$(loki_lineas "$q")" ;;
    esac
    if [ "$datos" -gt 0 ]; then
      paso_ok "La consulta $n devuelve datos"
    else
      paso_falla "La consulta $n no devuelve datos" "Ejecútala en Explore con Loki y corrígela."
    fi
  done <<FIN
$REQUISITOS
FIN
fi

echo
echo "${NEGRITA}Alerta sobre logs${NORMAL}"

if curl -s --max-time 10 "$(loki_url)/loki/api/v1/rules" | grep -q "alert: $ALERTA"; then
  paso_ok "El ruler de Loki tiene cargada la alerta $ALERTA"
else
  paso_falla "El ruler de Loki no tiene la alerta $ALERTA" \
    "Crea infra/loki/reglas/fake/tianguis-logs.yaml, configura el ruler y reinicia Loki."
fi

for estado in firing resolved; do
  n="$(curl -s --max-time 15 -G "$(loki_url)/loki/api/v1/query" \
    --data-urlencode "query=sum(count_over_time({compose_service=\"webhook\"} |= \`\"alertnames\":\"$ALERTA\"\` |= \`\"status\":\"$estado\"\` [24h]))" \
    | tr -d '\r\n' | sed -n 's/.*"value":\[[0-9.]*,"\([0-9]*\)"\].*/\1/p')"
  if [ "${n:-0}" -gt 0 ]; then
    paso_ok "gpe-webhook recibió la alerta $ALERTA en estado $estado"
  else
    paso_falla "gpe-webhook no recibió la alerta $ALERTA en estado $estado" \
      "Espera los tiempos de la guía. El resuelto llega varios minutos después de apagar la falla."
  fi
done

if prom_existe 'sum(chaos_active) == 0'; then
  paso_ok "No queda ninguna falla de caos encendida"
else
  paso_falla "Queda una falla de caos encendida" "Apágalas con bin/caos.sh apagar."
fi

resumen
