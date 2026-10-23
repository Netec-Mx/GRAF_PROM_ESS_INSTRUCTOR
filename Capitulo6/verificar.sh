#!/usr/bin/env bash
# Práctica 6. Revisa el dashboard Tianguis · Multiambiente, su JSON exportado, el trace_id de
# hallazgo.md en Tempo y que el stack haya quedado en su estado normal.
set -u

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source-path=SCRIPTDIR source=../_comun/lib-practicas.sh
. "$AQUI/../_comun/lib-practicas.sh"

TITULO="Tianguis · Multiambiente"
EXPORTADO="$AQUI/mi-dashboard.json"
HALLAZGO="$AQUI/hallazgo.md"

# tempo_traza_lenta TRACE_ID  ->  0 si Tempo tiene esa traza y en ella pasarela.cobrar dura más
# de 1 segundo. Busca en las últimas 24 horas con TraceQL.
tempo_traza_lenta() {
  local ahora
  ahora="$(date +%s)"
  curl -s --max-time 15 -G "http://localhost:$(leer_env PUERTO_TEMPO)/api/search" \
    --data-urlencode "q={ trace:id = \"$1\" && name = \"pasarela.cobrar\" && duration > 1s }" \
    --data-urlencode "start=$((ahora - 86400))" --data-urlencode "end=$ahora" \
    | tr -d '\r\n' | grep -q "\"traceID\":\"0*${1#"${1%%[!0]*}"}\""
}

exigir_stack

echo "${NEGRITA}Dashboard ${TITULO}${NORMAL}"

if uid="$(grafana_dashboard_existe "$TITULO")"; then
  paso_ok "Existe el dashboard $TITULO"
  # Formato v2 del dashboard, sin espacios, para buscar con grep.
  json="$(grafana_api "/apis/dashboard.grafana.app/v2/namespaces/default/dashboards/$uid" | tr -d ' ')"
  tiene() { printf '%s\n' "$json" | grep -q -- "$1"; }

  while IFS='|' read -r tipo nombre como; do
    if tiene "\"kind\":\"$tipo\",\"spec\":{\"name\":\"$nombre\""; then
      paso_ok "Tiene la variable $nombre, de tipo $como"
    else
      paso_falla "Falta la variable $nombre, de tipo $como" "Agrégala con Add, Variable, y ponle ese nombre exacto."
    fi
  done <<FIN
QueryVariable|ambiente|consulta
QueryVariable|servicio|consulta
IntervalVariable|intervalo|intervalo
CustomVariable|umbral|personalizada
FIN

  if tiene '"kind":"AdhocVariable","group":"prometheus"'; then
    paso_ok "Tiene un filtro ad hoc sobre Prometheus"
  else
    paso_falla "Falta el filtro ad hoc sobre Prometheus" "Agrégalo con Add, Filter and Group by, y elige Prometheus."
  fi

  # Lo que sigue al nombre de la variable servicio, hasta 900 caracteres, debe nombrar a ambiente.
  servicio="$(printf '%s\n' "$json" | sed 's/.*"kind":"QueryVariable","spec":{"name":"servicio"//' | cut -c1-900)"
  if printf '%s\n' "$servicio" | grep -q "\\\$ambiente"; then
    paso_ok "La variable servicio depende de ambiente"
  else
    paso_falla "La consulta de servicio no usa \$ambiente" "Copia la consulta de la guía en la variable servicio."
  fi

  if tiene "\\[\\\$intervalo\\]"; then
    paso_ok "La variable intervalo se usa dentro de rate"
  else
    paso_falla "Ninguna consulta usa [\$intervalo]" "Cambia [5m] por [\$intervalo] en las consultas de los paneles."
  fi

  if tiene '"repeat":{"mode":"variable","value":"servicio"}'; then
    paso_ok "Hay un panel que se repite por servicio"
  else
    paso_falla "Ningún panel se repite por servicio" "En el panel, Repeat options, Repeat by variable, elige servicio."
  fi

  if tiene '"kind":"ConditionalRenderingVariable"'; then
    paso_ok "Hay una sección que se muestra según una variable"
  else
    paso_falla "Ninguna sección tiene reglas para mostrarse" "En la fila de pagos, Show / hide rules, Add rule, Template variable."
  fi

  if tiene '"url":"/explore'; then
    paso_ok "Hay un enlace de datos hacia Explore"
  else
    paso_falla "Ningún panel tiene un enlace de datos hacia Explore" "En el panel repetido, Data links and actions, Add link."
  fi

  if tiene '"exemplar":true'; then
    paso_ok "Hay un panel con exemplars"
  else
    paso_falla "Ningún panel muestra exemplars" "En el panel de pagos, Options de la consulta, enciende Exemplars."
  fi
else
  paso_falla "No existe el dashboard $TITULO" "Guárdalo con ese nombre exacto."
fi

echo
echo "${NEGRITA}JSON exportado${NORMAL}"

if [ -f "$EXPORTADO" ] && grep -q "\"title\": *\"$TITULO\"" "$EXPORTADO"; then
  paso_ok "Capitulo6/mi-dashboard.json es el dashboard $TITULO"
else
  paso_falla "Falta Capitulo6/mi-dashboard.json con el dashboard $TITULO" \
    "Exporta con Export, Export as code, Download file, y muévelo con mv a Capitulo6/mi-dashboard.json."
fi

echo
echo "${NEGRITA}Correlación${NORMAL}"

traza="$(grep -o -i -E '[0-9a-f]{32}' "$HALLAZGO" 2>/dev/null | head -n 1 | tr 'A-F' 'a-f')"
if [ -z "$traza" ]; then
  paso_falla "Capitulo6/hallazgo.md no tiene un trace_id" "Pega en el archivo los 32 caracteres del trace_id del exemplar."
elif tempo_traza_lenta "$traza"; then
  paso_ok "Tempo tiene la traza $traza y su pasarela.cobrar dura más de 1 segundo"
else
  paso_falla "Tempo no tiene una traza $traza con pasarela.cobrar sobre 1 segundo" \
    "Elige un exemplar de arriba del gráfico de pagos, que son los pagos lentos, y copia su trace_id."
fi

echo
echo "${NEGRITA}Todo de vuelta a la normalidad${NORMAL}"

if "$RAIZ/bin/trafico.sh" estado 2>/dev/null | grep -q '(nivel normal)'; then
  paso_ok "El tráfico quedó en nivel normal"
else
  paso_falla "El tráfico no está en nivel normal" "Déjalo así con bin/trafico.sh nivel normal."
fi

if prom_existe 'sum(chaos_active) == 0'; then
  paso_ok "No queda ninguna falla de caos encendida"
else
  paso_falla "Queda una falla de caos encendida" "Apágalas con bin/caos.sh apagar."
fi

resumen
