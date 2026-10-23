#!/usr/bin/env bash
# Práctica 1. Revisa las dos tablas de Capitulo1/mapa-de-senales.md.
# No necesita el stack arriba: solo lee el archivo.
set -u

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source-path=SCRIPTDIR source=../_comun/lib-practicas.sh
. "$AQUI/../_comun/lib-practicas.sh"

ARCHIVO="$AQUI/mapa-de-senales.md"
[ -f "$ARCHIVO" ] || paro "No encuentro Capitulo1/mapa-de-senales.md."

# fila NOMBRE  ->  la fila de la tabla cuya primera celda es NOMBRE.
fila() {
  tr -d '\r' < "$ARCHIVO" | awk -F'|' -v nombre="$1" '
    { c = $2; gsub(/^[ \t]+|[ \t]+$/, "", c)
      if (tolower(c) == tolower(nombre)) { print; exit } }'
}

# vacias FILA COLUMNAS  ->  cuántas de las primeras COLUMNAS celdas están vacías o no existen.
vacias() {
  printf '%s\n' "$1" | awk -F'|' -v columnas="$2" '
    { v = 0
      for (i = 2; i <= columnas + 1; i++) { c = $i; gsub(/^[ \t]+|[ \t]+$/, "", c); if (c == "") v++ }
      print v }'
}

# celda FILA NÚMERO  ->  el texto de esa celda, en minúsculas.
celda() {
  printf '%s\n' "$1" | awk -F'|' -v i="$2" '{ c = $(i + 1); gsub(/^[ \t]+|[ \t]+$/, "", c); print tolower(c) }'
}

# fila_completa NOMBRE COLUMNAS TABLA
fila_completa() {
  local linea faltan
  linea="$(fila "$1")"
  if [ -z "$linea" ]; then
    paso_falla "$3, fila $1" "No encuentro la fila. No cambies el nombre de la primera celda."
    return
  fi
  faltan="$(vacias "$linea" "$2")"
  if [ "$faltan" -eq 0 ]; then
    paso_ok "$3, fila $1 completa"
  else
    paso_falla "$3, fila $1" "Tiene $faltan celdas vacías."
  fi
}

# empieza_con_si_o_no NOMBRE  ->  0 si las celdas de métricas, logs y trazas empiezan con sí o no.
empieza_con_si_o_no() {
  local linea i
  linea="$(fila "$1")"
  for i in 2 3 4; do
    case "$(celda "$linea" "$i")" in
      si*|sí*|SÍ*|Sí*|no*) ;;
      *) return 1 ;;
    esac
  done
  return 0
}

# modelo_de NOMBRE  ->  la celda "Modelo de entrega" de ese componente, en minúsculas.
modelo_de() { celda "$(fila "$1")" 5; }

echo "${NEGRITA}Tabla 1. Señales por componente${NORMAL}"
for componente in catalogo pedidos pagos conciliacion k6; do
  fila_completa "$componente" 6 "Tabla 1"
done

sin_formato=""
for componente in catalogo pedidos pagos conciliacion k6; do
  empieza_con_si_o_no "$componente" || sin_formato="$sin_formato $componente"
done
if [ -z "$sin_formato" ]; then
  paso_ok "Métricas, logs y trazas responden sí o no en las cinco filas"
else
  paso_falla "Métricas, logs y trazas deben empezar con sí o con no" "Revisa las filas$sin_formato."
fi

for componente in catalogo pedidos; do
  case "$(modelo_de "$componente")" in
    *pull*) paso_ok "Modelo de entrega de $componente correcto" ;;
    *) paso_falla "Modelo de entrega de $componente" "Este servicio vive todo el día y publica /metrics. Piensa quién va a buscar a quién." ;;
  esac
done

case "$(modelo_de pagos)" in
  *push*otlp*|*otlp*push*) paso_ok "Modelo de entrega de pagos correcto" ;;
  *) paso_falla "Modelo de entrega de pagos" "pagos no publica /metrics. Lleva el agente de OpenTelemetry, que habla OTLP. Piensa quién inicia la entrega." ;;
esac

case "$(modelo_de conciliacion)" in
  *pushgateway*) paso_ok "Modelo de entrega de conciliacion correcto" ;;
  *) paso_falla "Modelo de entrega de conciliacion" "Cada corrida dura milisegundos y termina. Piensa dónde deja su resultado para que Prometheus lo encuentre." ;;
esac

echo
echo "${NEGRITA}Tabla 2. Comparación de herramientas${NORMAL}"
for herramienta in "Prometheus" "Graphite" "InfluxDB" "Backend compatible con OpenTelemetry"; do
  fila_completa "$herramienta" 5 "Tabla 2"
done

resumen
