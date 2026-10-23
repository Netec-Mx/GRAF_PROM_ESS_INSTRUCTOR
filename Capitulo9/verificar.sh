#!/usr/bin/env bash
# Práctica 9. Revisa la capa de escala (nginx, PostgreSQL, las dos réplicas de Grafana, el
# dashboard como código, el descubrimiento, la federación, Mimir y los límites), Advisor, el
# diagnóstico de El Buen Fin en Capitulo9/diagnostico.md y que el stack haya vuelto a la normalidad.
set -u

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source-path=SCRIPTDIR source=../_comun/lib-practicas.sh
. "$AQUI/../_comun/lib-practicas.sh"

PORTAL="http://localhost:8088"
DIAGNOSTICO="$AQUI/diagnostico.md"
RESPALDO="$AQUI/respaldo"
PIZARRON="tianguis-pizarron"

# Con la capa de escala, Grafana y Prometheus solo se ven a través de nginx.
prom_url() { echo "$PORTAL/prometheus"; }
grafana_api() {
  local ruta="$1"
  shift
  curl -s --max-time 10 -u "$(leer_env GRAFANA_ADMIN_USER):$(leer_env GRAFANA_ADMIN_PASSWORD)" \
    "$@" "$PORTAL/grafana$ruta" | tr -d '\r\n'
}

# codigo URL  ->  código HTTP de un GET.
codigo() { curl -s -o /dev/null --max-time 10 -w '%{http_code}' "$1"; }

# valor_de JSON  ->  el número de la primera serie de una respuesta de la API de Prometheus.
valor_de() { sed -n 's/.*"value":\[[0-9.]*,"\([^"]*\)"\].*/\1/p'; }

# prom_rango URL CONSULTA  ->  cuántas series devuelve la consulta en los últimos 60 minutos.
# Sirve para Prometheus y para Loki, que tienen la misma API de rango.
prom_rango() {
  local desde=$(( $(date +%s) - 3600 ))
  curl -s --max-time 15 -G "$1" --data-urlencode "query=$2" --data-urlencode "start=$desde" \
    --data-urlencode "end=$(date +%s)" --data-urlencode "step=60" | tr -d '\r\n' \
    | grep -o '"values":\[\[' | grep -c values
}

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

# problemas  ->  una línea por problema de diagnostico.md, con cinco campos separados por el carácter 037.
# Servicio, tipo de evidencia (promql, logql o texto), evidencia, síntoma y causa, en una línea.
problemas() {
  awk '
    function cerrar() {
      if (n > 0) printf "%s\037%s\037%s\037%s\037%s\n", servicio, tipo, evidencia, sintoma, causa
    }
    function sumar(actual, linea) { return actual == "" ? linea : actual " " linea }
    /^## / { cerrar(); n++; servicio = ""; tipo = "texto"; evidencia = ""; sintoma = ""; causa = ""; seccion = ""; next }
    /^### / { seccion = tolower($0); next }
    /^```/ {
      if (dentro) { dentro = 0 } else { dentro = 1; lenguaje = substr($0, 4); if (lenguaje != "") tipo = lenguaje }
      next
    }
    n == 0 || $0 ~ /^[ \t]*$/ { next }
    seccion ~ /servicio/ { servicio = sumar(servicio, $0) }
    seccion ~ /ntoma/    { sintoma = sumar(sintoma, $0) }
    seccion ~ /evidencia/ { evidencia = sumar(evidencia, $0) }
    seccion ~ /causa/    { causa = sumar(causa, $0) }
    END { cerrar() }
  ' "$DIAGNOSTICO" | tr -d '\r'
}

# revisar_servicio NOMBRE  ->  busca en diagnostico.md el problema de ese servicio y revisa su
# evidencia. pagos necesita un trace_id real con pasarela.cobrar lento. Los otros, una consulta
# de PromQL o LogQL que nombre al servicio y devuelva datos.
revisar_servicio() {
  local nombre="$1" servicio tipo evidencia sintoma causa encontrado="" traza datos
  while IFS="$(printf '\037')" read -r servicio tipo evidencia sintoma causa; do
    servicio="$(printf '%s' "$servicio" | tr '[:upper:]' '[:lower:]')"
    case "$nombre:$servicio" in
      catalogo-dev:*catalogo*dev*) ;;
      pedidos:*dev*) continue ;;
      pedidos:*pedidos*) ;;
      pagos:*pagos*) ;;
      *) continue ;;
    esac
    encontrado=1
    if [ -z "$sintoma" ] || [ -z "$causa" ]; then
      paso_falla "El problema de $nombre no tiene síntoma o causa" "Escribe una frase debajo de cada título."
      return
    fi
    if [ "$nombre" = "pagos" ]; then
      traza="$(printf '%s' "$evidencia" | grep -o -E '[0-9a-f]{32}' | head -n 1)"
      if [ -z "$traza" ]; then
        paso_falla "La evidencia de pagos no tiene un trace_id" "Pega el trace_id de un pago lento, sacado de un exemplar o de Tempo."
      elif tempo_traza_lenta "$traza"; then
        paso_ok "pagos tiene como evidencia la traza $traza, con pasarela.cobrar sobre 1 segundo"
      else
        paso_falla "Tempo no tiene una traza $traza con pasarela.cobrar sobre 1 segundo" \
          "Elige un pago lento. En su traza, pasarela.cobrar tiene que durar más de 1 segundo."
      fi
      return
    fi
    case "$tipo" in
      promql) datos="$(prom_rango "$(prom_url)/api/v1/query_range" "$evidencia")" ;;
      logql) datos="$(prom_rango "http://localhost:$(leer_env PUERTO_LOKI)/loki/api/v1/query_range" "$evidencia")" ;;
      *) paso_falla "La evidencia de $nombre no es una consulta" "Pon la consulta en un bloque promql o logql."; return ;;
    esac
    if ! printf '%s' "$evidencia" | grep -q "${nombre%-dev}"; then
      paso_falla "La consulta de $nombre no nombra al servicio" "Filtra por $nombre en la consulta."
    elif [ "${datos:-0}" -gt 0 ]; then
      paso_ok "$nombre tiene como evidencia una consulta de $tipo que devuelve datos"
    else
      paso_falla "La consulta de $nombre no devuelve datos en la última hora" "Ejecútala en Explore y corrígela."
    fi
    return
  done <<FIN
$(problemas)
FIN
  [ -n "$encontrado" ] || paso_falla "El diagnóstico no tiene un problema de $nombre" \
    "Hay tres servicios con problemas. Revisa la página de alertas y los paneles RED."
}

chequear_docker
[ -f "$ENV_FILE" ] || paro "No existe infra/.env. Levanta el stack con bin/up.sh."

echo "${NEGRITA}Portería${NORMAL}"

if [ "$(codigo "$PORTAL/grafana/api/health")" = "200" ] && [ "$(codigo "$PORTAL/prometheus/-/ready")" = "200" ]; then
  paso_ok "nginx atiende /grafana y /prometheus"
else
  paso_falla "nginx no atiende /grafana o /prometheus" "Levanta la capa con compose.escala.yaml y revisa docker logs gpe-nginx."
fi

if [ "$(codigo "http://localhost:$(leer_env PUERTO_GRAFANA)/api/health")" = "000" ] \
  && [ "$(codigo "http://localhost:$(leer_env PUERTO_PROMETHEUS)/-/ready")" = "000" ]; then
  paso_ok "Grafana y Prometheus ya no tienen puerto propio, solo se llega por nginx"
else
  paso_falla "Grafana o Prometheus siguen respondiendo en su puerto propio" "Levanta la capa con compose.escala.yaml."
fi

echo
echo "${NEGRITA}Base de datos y réplicas${NORMAL}"

if grafana_api "/api/admin/settings" | grep -q '"type":"postgres"'; then
  paso_ok "Grafana guarda sus datos en PostgreSQL"
else
  paso_falla "Grafana no está usando PostgreSQL" "Levanta la capa con compose.escala.yaml."
fi

if [ -f "$AQUI/secretos/postgres" ] \
  && ! grep -v '^ *#' "$AQUI/compose.escala.yaml" | grep -v '_FILE' | grep -q -E 'PASSWORD[A-Z_]*: *[^$ ]'; then
  paso_ok "La clave de PostgreSQL se lee de Capitulo9/secretos/postgres y no está escrita en el compose"
else
  paso_falla "La clave de PostgreSQL no se lee de un archivo" "Crea Capitulo9/secretos/postgres desde postgres.ejemplo y usa las variables _FILE."
fi

if [ "$(contenedor_salud gpe-grafana-2)" = "healthy" ] && [ "$(contenedor_salud gpe-grafana)" = "healthy" ]; then
  docker stop gpe-grafana-2 >/dev/null 2>&1
  # nginx vuelve a preguntar al DNS cada 10 segundos. Se le dan 15 para que se entere.
  sleep 15
  atendidas=0
  for _ in 1 2 3 4 5 6; do
    [ "$(codigo "$PORTAL/grafana/api/health")" = "200" ] && atendidas=$((atendidas + 1))
  done
  docker start gpe-grafana-2 >/dev/null 2>&1
  if [ "$atendidas" -eq 6 ]; then
    paso_ok "Con gpe-grafana-2 detenida, nginx atendió 6 de 6 peticiones con la otra réplica"
  else
    paso_falla "Con gpe-grafana-2 detenida, nginx atendió $atendidas de 6 peticiones" "Revisa el upstream grafanas en Capitulo9/escala/nginx/portal.conf."
  fi
else
  paso_falla "Las dos réplicas de Grafana no están healthy" "Revisa bin/estado.sh y espera a que arranquen."
fi

if ! ls "$RESPALDO"/*.json >/dev/null 2>&1; then
  paso_falla "No hay dashboards respaldados en Capitulo9/respaldo" "Respalda los dashboards antes de levantar la capa, como en el paso 5 de la guía."
else
  faltan=""
  for archivo in "$RESPALDO"/*.json; do
    uid="$(basename "$archivo" .json)"
    [ "$uid" = "$PIZARRON" ] && continue
    grafana_api "/api/dashboards/uid/$uid" | grep -q '"uid":"'"$uid"'"' || faltan="$faltan $uid"
  done
  if [ -z "$faltan" ]; then
    paso_ok "Los dashboards respaldados están en Grafana sobre PostgreSQL"
  else
    paso_falla "Faltan en Grafana los dashboards respaldados:$faltan" "Impórtalos con el bucle de curl del paso 9 de la guía."
  fi
fi

echo
echo "${NEGRITA}Dashboard como código${NORMAL}"

json="$(grafana_api "/api/dashboards/uid/$PIZARRON")"
if printf '%s' "$json" | grep -q '"provisioned":true'; then
  respuesta="$(printf '%s' "$json" | grafana_api "/api/dashboards/db" -X POST -H 'Content-Type: application/json' -d @-)"
  if printf '%s' "$respuesta" | grep -q -i 'provisioned'; then
    paso_ok "El dashboard Tianguis · Pizarrón está aprovisionado y Grafana no deja guardarlo"
  else
    paso_falla "Grafana dejó guardar el dashboard aprovisionado" "Revisa allowUiUpdates en el proveedor como-codigo."
  fi
else
  paso_falla "El dashboard Tianguis · Pizarrón no está aprovisionado" "Revisa que Capitulo9/dashboards/tianguis-pizarron.json exista."
fi

echo
echo "${NEGRITA}Descubrimiento, federación y Mimir${NORMAL}"

config="$(curl -s --max-time 10 "$(prom_url)/api/v1/status/config" | tr -d '\r')"
if printf '%s' "$config" | grep -q 'file_sd_configs' \
  && [ "$(prom_destinos_con catalogo ambiente dev)" -ge 1 ] && [ "$(prom_destinos_con pedidos ambiente dev)" -ge 1 ]; then
  paso_ok "catalogo-dev y pedidos-dev llegan por file_sd"
else
  paso_falla "Prometheus no tiene a catalogo-dev y pedidos-dev por file_sd" \
    "Usa file_sd_configs en los jobs catalogo y pedidos y agrega pedidos-dev a destinos/pedidos.yml."
fi

if prom_existe 'up{job="descubierto-por-http"} == 1'; then
  paso_ok "El job descubierto-por-http encontró su destino por HTTP"
else
  paso_falla "No hay destinos del job descubierto-por-http" "Agrega el job con http_sd_configs hacia http://nginx/sd/destinos.json."
fi

borde="$(curl -s --max-time 10 -G "$PORTAL/borde/api/v1/query" --data-urlencode 'query=count({__name__=~".+", job!="prometheus-borde"})' | valor_de)"
principal="$(prom_consulta 'prometheus_tsdb_head_series{job="prometheus"}')"
if [ -n "$borde" ] && [ -n "$principal" ] && [ "${borde%.*}" -gt 0 ] && [ "${borde%.*}" -lt "${principal%.*}" ]; then
  paso_ok "El Prometheus de borde federa $borde series, contra $principal del principal"
else
  paso_falla "El Prometheus de borde no tiene series federadas" "Agrega el job federacion en Capitulo9/borde/prometheus.yml y recarga."
fi

if prom_existe 'prometheus_remote_storage_samples_total{remote_name="mimir"} > 0'; then
  paso_ok "Prometheus envía muestras a Mimir con remote_write"
else
  paso_falla "Prometheus no envía muestras a Mimir" "Agrega remote_write hacia http://mimir:9009/api/v1/push y recarga."
fi

mimir="$(grafana_api "/api/datasources" | tr "{" "\n" | grep '"url":"http://mimir' | grep -o '"uid":"[^"]*"' | head -n 1 | cut -d'"' -f4)"
if [ -z "$mimir" ]; then
  paso_falla "Grafana no tiene un datasource que apunte a Mimir" "Agrega un datasource Prometheus con la URL http://mimir:9009/prometheus."
elif grafana_api "/api/datasources/proxy/uid/$mimir/api/v1/query" -G --data-urlencode 'query=up{job="catalogo"}' | grep -q '"value":\['; then
  paso_ok "Mimir devuelve la serie up de catalogo que escribió Prometheus"
else
  paso_falla "Mimir no devuelve up de catalogo" "Revisa remote_write y la URL del datasource, que termina en /prometheus."
fi

echo
echo "${NEGRITA}Control de recursos${NORMAL}"

if printf '%s' "$config" | grep -q 'sample_limit: 5000' && printf '%s' "$config" | grep -q 'label_limit: 30'; then
  paso_ok "El job loki tiene sample_limit y label_limit"
else
  paso_falla "Prometheus no tiene sample_limit 5000 y label_limit 30" "Agrégalos al job loki y recarga."
fi

leidas="$(prom_consulta 'scrape_samples_scraped{job="loki"}')"
guardadas="$(prom_consulta 'scrape_samples_post_metric_relabeling{job="loki"}')"
if [ -n "$leidas" ] && [ -n "$guardadas" ] && [ "${guardadas%.*}" -lt "${leidas%.*}" ] && prom_existe 'up{job="loki"} == 1'; then
  paso_ok "metric_relabel_configs descarta series de loki, se guardan $guardadas de $leidas y el destino está UP"
else
  paso_falla "El job loki no descarta series o quedó abajo" "Agrega el drop de loki_(request|response)_message_bytes_.* y recarga."
fi

if curl -s --max-time 10 "$(prom_url)/api/v1/status/runtimeinfo" | grep -q '"storageRetention":"[^"]*GiB'; then
  paso_ok "Prometheus tiene retención por tamaño"
else
  paso_falla "Prometheus no tiene retención por tamaño" "Agrega storage.tsdb.retention.size en prometheus.yml y recarga."
fi

echo
echo "${NEGRITA}Grafana Advisor${NORMAL}"

if grafana_api "/apis/advisor.grafana.app/v0alpha1/namespaces/default/checks" | grep -q '"kind": *"Check"'; then
  paso_ok "Advisor revisó la instancia"
else
  paso_falla "Advisor no tiene revisiones" "Abre Administration, Advisor y pulsa el botón de recargar."
fi

echo
echo "${NEGRITA}Diagnóstico de El Buen Fin${NORMAL}"

if [ ! -f "$DIAGNOSTICO" ]; then
  paso_falla "No existe Capitulo9/diagnostico.md" "Recupéralo con git checkout -- Capitulo9/diagnostico.md."
else
  for servicio in pedidos pagos catalogo-dev; do
    revisar_servicio "$servicio"
  done
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

if prom_existe 'count(ALERTS{alertstate="firing", alertname=~"ErroresAltos|LatenciaAlta|PagosLentos"})'; then
  paso_falla "Todavía hay alertas de El Buen Fin sonando" "Espera unos minutos después de apagar las fallas."
else
  paso_ok "Las alertas de El Buen Fin se resolvieron"
fi

resumen
