#!/usr/bin/env bash
# Práctica 3. Ejecuta contra Prometheus cada consulta de Capitulo3/consultas.md y revisa que el
# caos haya quedado apagado y que catalogo vuelva a tener una cantidad normal de series.
set -u

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source-path=SCRIPTDIR source=../_comun/lib-practicas.sh
. "$AQUI/../_comun/lib-practicas.sh"

ARCHIVO="$AQUI/consultas.md"
PREGUNTAS=20
# Con el tráfico normal catalogo prod tiene menos de 100 series. Con la bomba pasa de 3000.
SERIES_NORMALES=200

exigir_stack
[ -f "$ARCHIVO" ] || paro "No existe Capitulo3/consultas.md. Recupéralo con git checkout -- Capitulo3/consultas.md"

# Lo que cada respuesta tiene que usar, para que no valga cualquier consulta que devuelva datos.
# Número, texto que debe aparecer y pista si no aparece.
REQUISITOS='1|status=~|Usa un matcher de expresión regular sobre status.
2|{"http_server_requests_total"|El nombre va entre comillas y dentro de las llaves.
3|rate(|Un contador se lee con rate.
4|increase(|Para el total de una ventana se usa increase.
5|resets(|Hay una función que cuenta las vueltas a cero de un contador.
6|by (|Agrega con sum y una cláusula by.
7|topk(|Para quedarte con las tres primeras usa topk.
8|rate(|La tasa de un contador sale con rate.
9|5..|Los errores son las respuestas con status 5xx.
10|histogram_quantile(|El percentil sale de histogram_quantile, sin _bucket.
11|_bucket|El histograma clásico se consulta con las series _bucket.
12|_bucket|El histograma clásico se consulta con las series _bucket.
13|quantile=|El summary ya trae el cuantil como etiqueta.
14|node_cpu_seconds_total|La CPU sale de node_cpu_seconds_total.
15|node_memory_MemAvailable_bytes|La memoria disponible sale de node_memory_MemAvailable_bytes.
16|node_load|La saturación de CPU se lee con la carga, node_load1.
17|prometheus_tsdb_head_series|Prometheus publica su propia cuenta de series.
18|count by (job)|Cuenta las series agrupando por job.
19|__name__|El nombre de la métrica es la etiqueta __name__.
20|count by (route)|Cuenta las series agrupando por route.'

# respuestas  ->  una línea por bloque promql, "NÚMERO<tab>CONSULTA", con la consulta en una
# sola línea. El número es el de la pregunta que está arriba del bloque.
respuestas() {
  tr -d '\r' < "$ARCHIVO" | awk '
    /^## [0-9]+\./ { n = $2; sub(/\./, "", n) }
    /^```promql/   { dentro = 1; consulta = ""; next }
    /^```/         { if (dentro) printf "%s\t%s\n", n, consulta; dentro = 0; next }
    dentro         { consulta = consulta " " $0 }'
}

recortar() { printf '%s' "$1" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//'; }

echo "${NEGRITA}Consultas de Capitulo3/consultas.md${NORMAL}"

todas="$(respuestas)"
n=1
while [ "$n" -le "$PREGUNTAS" ]; do
  consulta="$(recortar "$(printf '%s\n' "$todas" | awk -F '\t' -v n="$n" '$1 == n { print $2; exit }')")"
  requisito="$(printf '%s\n' "$REQUISITOS" | awk -F '|' -v n="$n" '$1 == n { print $2; exit }')"
  pista="$(printf '%s\n' "$REQUISITOS" | awk -F '|' -v n="$n" '$1 == n { print $3; exit }')"

  if [ -z "$consulta" ]; then
    paso_falla "Pregunta $n sin respuesta" "Escribe la consulta dentro del bloque promql de la pregunta $n."
  elif ! printf '%s' "$consulta" | grep -qF -- "$requisito"; then
    paso_falla "Pregunta $n no responde lo que se pregunta" "$pista"
  else
    json="$(prom_json "$consulta")"
    if printf '%s' "$json" | grep -q '"status":"error"'; then
      paso_falla "Pregunta $n tiene un error de sintaxis" \
        "$(printf '%s' "$json" | sed -n 's/.*"error":"\(.*\)".*/\1/p' | sed 's/\\"/"/g' | cut -c1-110)"
    elif printf '%s' "$json" | grep -q '"result":\[{'; then
      paso_ok "Pregunta $n devuelve datos"
    else
      paso_falla "Pregunta $n no devuelve datos" \
        "Ejecútala en Prometheus. Si no hay series que sumar, revisa or vector(0) en el paso 5 de la guía."
    fi
  fi
  n=$((n + 1))
done

echo
echo "${NEGRITA}Estado del stack${NORMAL}"

encendidas="$(prom_consulta 'sum(chaos_active{job=~"catalogo|pedidos"})')"
if [ -n "$encendidas" ] && [ "$encendidas" = "0" ]; then
  paso_ok "No queda ninguna falla de caos encendida en catalogo ni en pedidos"
else
  paso_falla "Queda alguna falla de caos encendida" "Míralas con bin/caos.sh estado y apágalas como en la guía."
fi

series="$(prom_consulta 'count({job="catalogo", ambiente="prod"})')"
if [ -n "$series" ] && [ "$series" -lt "$SERIES_NORMALES" ]; then
  paso_ok "catalogo en prod volvió a una cantidad normal de series, $series"
else
  paso_falla "catalogo en prod tiene ${series:-0} series" \
    "Apaga la falla cardinalidad y reinicia catalogo con docker restart gpe-catalogo."
fi

resumen
