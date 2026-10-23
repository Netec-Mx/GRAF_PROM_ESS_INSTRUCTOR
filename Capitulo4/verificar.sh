#!/usr/bin/env bash
# Práctica 4. Revisa en Grafana el dashboard Tianguis · RED y el JSON exportado.
set -u

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source-path=SCRIPTDIR source=../_comun/lib-practicas.sh
. "$AQUI/../_comun/lib-practicas.sh"

TITULO="Tianguis · RED"
EXPORTADO="$AQUI/mi-dashboard.json"

# Tipo de panel y nombre con que aparece en la lista de visualizaciones de Grafana.
VISUALIZACIONES='stat|Stat
gauge|Gauge
bargauge|Bar gauge
timeseries|Time series
heatmap|Heatmap
table|Table
text|Text
dashlist|Dashboard list
logs|Logs'

exigir_stack

echo "${NEGRITA}Dashboard ${TITULO}${NORMAL}"

if uid="$(grafana_dashboard_existe "$TITULO")"; then
  paso_ok "Existe el dashboard $TITULO"
  json="$(grafana_dashboard_json "$uid")"
  tiene() { printf '%s\n' "$json" | grep -q -- "$1"; }

  while IFS='|' read -r tipo nombre; do
    if tiene "\"type\":\"$tipo\""; then
      paso_ok "Tiene un panel $nombre"
    else
      paso_falla "Falta un panel $nombre" "Agrégalo con Add panel, elige $nombre en All visualizations y guarda."
    fi
  done <<FIN
$VISUALIZACIONES
FIN

  if tiene '"type":"loki"'; then
    paso_ok "Hay un panel que consulta Loki"
  else
    paso_falla "Ningún panel consulta Loki" "En el panel de logs elige Loki en Data source."
  fi

  if tiene '"timeShift":"[^"]'; then
    paso_ok "Hay un panel con desplazamiento de tiempo"
  else
    paso_falla "Ningún panel tiene desplazamiento de tiempo" "Ponlo en Query options, campo Time shift."
  fi

  if tiene '"timeFrom":"[^"]'; then
    paso_ok "Hay un panel con tiempo relativo propio"
  else
    paso_falla "Ningún panel tiene tiempo relativo propio" "Ponlo en Query options, campo Relative time."
  fi

  if tiene '"transformations":\[{'; then
    paso_ok "Hay un panel con transformaciones"
  else
    paso_falla "Ningún panel tiene transformaciones" "En la tabla abre la pestaña Transformations y agrega una."
  fi

  grupos="$(grafana_dashboard_grupos "$uid")"
  if [ "$grupos" -ge 2 ]; then
    paso_ok "Los paneles están ordenados en $grupos filas o pestañas"
  else
    paso_falla "Los paneles no están ordenados en filas o pestañas" "Separa los paneles en al menos dos filas y guarda."
  fi
else
  paso_falla "No existe el dashboard $TITULO" \
    "Créalo en Grafana y guárdalo con ese título. Las verificaciones de sus paneles quedan pendientes."
fi

echo
echo "${NEGRITA}JSON exportado${NORMAL}"

if [ -f "$EXPORTADO" ] && tr -d '\r\n' < "$EXPORTADO" | grep -q "\"title\": *\"$TITULO\""; then
  paso_ok "Capitulo4/mi-dashboard.json trae el dashboard $TITULO"
elif [ -f "$EXPORTADO" ]; then
  paso_falla "Capitulo4/mi-dashboard.json no es el dashboard $TITULO" "Expórtalo de nuevo desde Export, Export as code."
else
  paso_falla "No existe Capitulo4/mi-dashboard.json" "Usa Export, Export as code, Download file y mueve el archivo a la carpeta Capitulo4."
fi

resumen
