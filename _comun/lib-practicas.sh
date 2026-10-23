#!/usr/bin/env bash
# Funciones que usan preparar.sh, verificar.sh y restaurar.sh de cada práctica.
# Compatible con bash 3.2 (macOS) y Git Bash (Windows). Sin python3 ni jq.
# Puertos y credenciales salen siempre de infra/.env.

COMUN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source-path=SCRIPTDIR source=../bin/common.sh
. "$COMUN_DIR/../bin/common.sh"

# En Git Bash de Windows curl usa Schannel, que revisa si cada certificado fue revocado. La CA de
# la Práctica 7 no publica una lista de revocación y Schannel la rechaza con "the revocation
# status is unknown". Solo ahí se apaga esa revisión. En macOS y Linux curl queda igual.
if curl -V 2>/dev/null | grep -q Schannel; then
  curl() { command curl --ssl-no-revoke "$@"; }
fi

PASOS_BIEN=0
PASOS_MAL=0

# paso_ok MENSAJE  ->  anota un paso logrado.
paso_ok() {
  PASOS_BIEN=$((PASOS_BIEN + 1))
  printf '%s\n' "${VERDE}[  OK  ]${NORMAL} $1"
}

# paso_falla MENSAJE [PISTA]  ->  anota un paso que falta. La pista dice cómo resolverlo.
paso_falla() {
  PASOS_MAL=$((PASOS_MAL + 1))
  printf '%s\n' "${ROJO}[ FALTA ]${NORMAL} $1"
  if [ -n "${2:-}" ]; then
    printf '%s\n' "          $2"
  fi
}

# resumen  ->  imprime el total y devuelve 0 si no faltó nada, 1 si faltó algo.
resumen() {
  local total=$((PASOS_BIEN + PASOS_MAL))
  echo
  if [ "$PASOS_MAL" -eq 0 ]; then
    printf '%s\n' "${VERDE}${NEGRITA}PRÁCTICA LOGRADA${NORMAL} $PASOS_BIEN de $total verificaciones en verde"
    return 0
  fi
  printf '%s\n' "${ROJO}${NEGRITA}TODAVÍA FALTA${NORMAL} $PASOS_MAL de $total verificaciones en rojo"
  return 1
}

# exigir_stack  ->  PARO si Docker o los servicios que consultan las verificaciones no responden.
exigir_stack() {
  chequear_docker
  [ -f "$ENV_FILE" ] || paro "No existe infra/.env. Levanta el stack con bin/up.sh."
  [ "$(contenedor_estado gpe-prometheus)" = "running" ] || paro "gpe-prometheus no está corriendo. Levanta el stack con bin/up.sh."
  [ "$(contenedor_estado gpe-grafana)" = "running" ] || paro "gpe-grafana no está corriendo. Levanta el stack con bin/up.sh."
}

# contenedor_estado NOMBRE  ->  running, exited, paused... o "no existe".
contenedor_estado() {
  local estado
  estado="$(docker inspect --format '{{.State.Status}}' "$1" 2>/dev/null)"
  echo "${estado:-no existe}"
}

# contenedor_salud NOMBRE  ->  healthy, starting, unhealthy... o "sin dato".
contenedor_salud() {
  local salud
  salud="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$1" 2>/dev/null)"
  echo "${salud:-sin dato}"
}

prom_url() { echo "http://localhost:$(leer_env PUERTO_PROMETHEUS)"; }

# prom_json CONSULTA  ->  respuesta cruda de la API para una consulta instantánea.
prom_json() {
  curl -s --max-time 10 -G --data-urlencode "query=$1" "$(prom_url)/api/v1/query" | tr -d '\r\n'
}

# prom_consulta CONSULTA  ->  valor de la consulta. Está pensada para consultas que devuelven
# una sola serie, como sum(...) o count(...). Sin series no imprime nada.
prom_consulta() {
  local valor
  valor="$(prom_json "$1" | sed -n 's/.*"value":\[[0-9.]*,"\([^"]*\)"\].*/\1/p')"
  [ -n "$valor" ] && echo "$valor"
  return 0
}

# prom_existe CONSULTA  ->  0 si la consulta devuelve al menos una serie.
prom_existe() {
  prom_json "$1" | grep -q '"value":\['
}

# prom_destinos  ->  imprime "ARRIBA TOTAL" con los destinos activos que Prometheus raspa.
prom_destinos() {
  local salud total arriba
  salud="$(curl -s --max-time 10 "$(prom_url)/api/v1/targets?state=active" | tr -d '\r\n' | grep -o '"health":"[a-z]*"')"
  total="$(printf '%s\n' "$salud" | grep -c 'health')"
  arriba="$(printf '%s\n' "$salud" | grep -c '"up"')"
  echo "$arriba $total"
}

# prom_destinos_con JOB ETIQUETA VALOR  ->  cuántos destinos activos de ese job llevan la etiqueta
# con ese valor. Mira los destinos y no las series, que tardan 5 minutos en dejar de verse.
prom_destinos_con() {
  curl -s --max-time 10 "$(prom_url)/api/v1/targets?state=active" | tr -d '\r\n' \
    | grep -o '"labels":{[^}]*}' | grep "\"job\":\"$1\"" | grep -c "\"$2\":\"$3\""
}

# grafana_api RUTA [opciones de curl]  ->  llama a la API de Grafana como administrador.
grafana_api() {
  local ruta="$1"
  shift
  curl -s --max-time 10 -u "$(leer_env GRAFANA_ADMIN_USER):$(leer_env GRAFANA_ADMIN_PASSWORD)" \
    "$@" "http://localhost:$(leer_env PUERTO_GRAFANA)$ruta" | tr -d '\r\n'
}

# url_codificar TEXTO  ->  TEXTO codificado para una URL, byte a byte en UTF-8. En Windows curl
# recibe sus argumentos en la página de códigos del sistema y no en UTF-8, así que un título con
# · o con tilde llegaría mal con --data-urlencode. Codificado aquí, el argumento ya es ASCII.
url_codificar() {
  local hex salida=""
  for hex in $(printf '%s' "$1" | od -An -v -tx1); do
    case "$hex" in
      3[0-9]|4[1-9a-f]|5[0-9a]|6[1-9a-f]|7[0-9a]|2d|2e|5f|7e) salida+="$(printf '%b' "\\x$hex")" ;;
      *) salida+="%$hex" ;;
    esac
  done
  printf '%s' "$salida"
}

# grafana_dashboard_existe TEXTO  ->  imprime el uid del primer dashboard cuyo título contiene
# TEXTO y devuelve 0. Si no hay ninguno devuelve 1.
grafana_dashboard_existe() {
  local uid
  uid="$(grafana_api "/api/search?type=dash-db&query=$(url_codificar "$1")" \
    | grep -o '"uid":"[^"]*"' | head -n 1 | cut -d'"' -f4)"
  [ -n "$uid" ] || return 1
  echo "$uid"
}

# grafana_dashboard_json UID  ->  el dashboard en el formato clásico de la API. Ahí cada panel
# trae su gridPos, y las filas y pestañas llegan como paneles de tipo row.
grafana_dashboard_json() {
  grafana_api "/api/dashboards/uid/$1"
}

# grafana_dashboard_paneles UID  ->  cuántos paneles tiene, sin contar filas ni pestañas.
grafana_dashboard_paneles() {
  local json todos filas
  json="$(grafana_dashboard_json "$1")"
  todos="$(printf '%s\n' "$json" | grep -o '"gridPos":' | grep -c 'gridPos')"
  filas="$(printf '%s\n' "$json" | grep -o '"type":"row"' | grep -c 'row')"
  echo $((todos - filas))
}

# grafana_dashboard_grupos UID  ->  cuántas filas o pestañas tiene.
grafana_dashboard_grupos() {
  grafana_dashboard_json "$1" | grep -o '"type":"row"' | grep -c 'row'
}

# grafana_importar ARCHIVO  ->  carga en Grafana un dashboard exportado con Export as code, en el
# formato v2. Si ya existe uno con el mismo uid, lo reemplaza. Devuelve 1 si Grafana lo rechaza.
grafana_importar() {
  local nombre
  nombre="$(tr -d '\r\n' < "$1" | sed -n 's/.*"metadata": *{ *"name": *"\([^"]*\)".*/\1/p')"
  [ -n "$nombre" ] || return 1
  grafana_api "/apis/dashboard.grafana.app/v2/namespaces/default/dashboards/$nombre" -X DELETE >/dev/null
  grafana_api "/apis/dashboard.grafana.app/v2/namespaces/default/dashboards" -X POST \
    -H 'Content-Type: application/json' --data-binary "@$1" | grep -q '"kind": *"Dashboard"'
}

# igual_adentro CONTENEDOR RUTA ARCHIVO  ->  0 si el contenedor ya ve ARCHIVO en RUTA. Docker
# Desktop tarda un momento en pasar al contenedor un archivo recién copiado. Si el servicio se
# recarga antes, lee la versión anterior.
igual_adentro() {
  MSYS_NO_PATHCONV=1 docker exec "$1" cat "$2" 2>/dev/null | cmp -s - "$3"
}

# copiar_adentro ORIGEN DESTINO CONTENEDOR RUTA  ->  copia ORIGEN sobre DESTINO, que el contenedor
# monta en RUTA, y espera hasta 60 segundos a que el contenedor lo vea. PARO si no lo ve.
copiar_adentro() {
  mkdir -p "$(dirname "$2")"
  cp "$1" "$2" || paro "No pude copiar ${2#"$RAIZ"/}."
  esperar_hasta 60 "que $3 vea ${2#"$RAIZ"/}" igual_adentro "$3" "$4" "$2"
}

# esperar_hasta SEGUNDOS QUÉ COMANDO...  ->  repite COMANDO cada 5 segundos hasta que salga con 0.
# PARO si pasan SEGUNDOS.
esperar_hasta() {
  local tope="$1" que="$2" inicio
  shift 2
  inicio=$(date +%s)
  until "$@"; do
    [ $(( $(date +%s) - inicio )) -lt "$tope" ] || paro "Pasaron ${tope}s esperando $que."
    sleep 5
  done
}

# confirmar_cambios PRÁCTICA LÍNEA...  ->  avisa qué archivos cambian y pide escribir SI. Sin
# SI termina el script sin tocar nada.
confirmar_cambios() {
  local practica="$1" linea
  shift
  echo "${ROJO}${NEGRITA}"
  echo "============================================================"
  echo "  SE VA A DEJAR RESUELTA LA PRÁCTICA $practica"
  for linea in "$@"; do
    echo "    $linea"
  done
  echo "============================================================"
  echo "  SE PIERDE LO QUE HICISTE EN ESOS ARCHIVOS."
  echo "  NO HAY VUELTA ATRÁS."
  echo "============================================================"
  echo "${NORMAL}"
  if ! confirmar_si; then
    echo
    ok "No se confirmó. No se tocó nada."
    exit 0
  fi
}

# confirmar_si  ->  pide escribir SI. Devuelve 0 solo si la respuesta es exactamente SI.
confirmar_si() {
  local respuesta=""
  printf '%s' "Escribe SI para continuar: "
  read -r respuesta || true
  [ "$(printf '%s' "$respuesta" | tr -d '\r')" = "SI" ]
}
