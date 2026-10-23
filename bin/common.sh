#!/usr/bin/env bash
# Funciones compartidas por los scripts de bin/.
# Compatible con bash 3.2 (macOS) y Git Bash (Windows). Sin python3 ni jq.

PROYECTO="gpe"

BIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$BIN_DIR/.." && pwd)"
INFRA="$RAIZ/infra"
ENV_FILE="$INFRA/.env"
ENV_EJEMPLO="$INFRA/.env.example"
COMPOSE_FILE="$INFRA/compose.yaml"

# Servicios con healthcheck, en el orden en que se muestran.
SERVICIOS="prometheus alertmanager grafana loki tempo alloy otelcol node-exporter pushgateway mailpit webhook catalogo pedidos pagos conciliacion catalogo-dev pedidos-dev k6"

# Puertos que el stack publica en el host.
VARS_PUERTOS="PUERTO_GRAFANA PUERTO_PROMETHEUS PUERTO_ALERTMANAGER PUERTO_PUSHGATEWAY PUERTO_NODE_EXPORTER PUERTO_LOKI PUERTO_TEMPO PUERTO_ALLOY PUERTO_OTLP_GRPC PUERTO_OTLP_HTTP PUERTO_MAILPIT_UI PUERTO_MAILPIT_SMTP PUERTO_CATALOGO PUERTO_PEDIDOS PUERTO_PAGOS PUERTO_CATALOGO_DEV PUERTO_PEDIDOS_DEV"

# Puertos que el stack nunca publica, porque suelen estar ocupados por otros servicios.
PUERTOS_PROHIBIDOS="5432 8081"

# Colores solo si la salida es una terminal. CLICOLOR_FORCE=1 los fuerza aunque no lo sea
# (sirve para guardar la salida con colores) y NO_COLOR los apaga siempre.
if { [ -t 1 ] || [ -n "${CLICOLOR_FORCE:-}" ]; } && [ -z "${NO_COLOR:-}" ]; then
  ROJO=$'\033[31m'; VERDE=$'\033[32m'; AMARILLO=$'\033[33m'; AZUL=$'\033[36m'
  NEGRITA=$'\033[1m'; NORMAL=$'\033[0m'
else
  ROJO=""; VERDE=""; AMARILLO=""; AZUL=""; NEGRITA=""; NORMAL=""
fi

info()  { printf '%s\n' "${AZUL}==>${NORMAL} $*"; }
ok()    { printf '%s\n' "${VERDE} OK${NORMAL} $*"; }
aviso() { printf '%s\n' "${AMARILLO}  !${NORMAL} $*"; }
error() { printf '%s\n' "${ROJO}ERROR${NORMAL} $*" >&2; }
paro()  { printf '%s\n' "${ROJO}${NEGRITA}PARO${NORMAL} $*" >&2; exit 1; }

chequear_docker() {
  command -v docker >/dev/null 2>&1 || paro "No encuentro docker en el PATH. Instala Docker Desktop."
  docker compose version >/dev/null 2>&1 || paro "Falta el plugin docker compose (viene con Docker Desktop)."
  docker info >/dev/null 2>&1 || paro "Docker no responde. Abre Docker Desktop y espera a que arranque."
}

# Crea infra/.env desde la plantilla si todavía no existe.
asegurar_env() {
  if [ ! -f "$ENV_FILE" ]; then
    cp "$ENV_EJEMPLO" "$ENV_FILE"
    info "Creé infra/.env a partir de infra/.env.example"
  fi
}

# Si a infra/.env le falta alguna variable de la plantilla (pasa al actualizar el repo), PARO.
chequear_env() {
  local var faltan=""
  for var in $(grep -E '^[A-Z_]+=' "$ENV_EJEMPLO" | cut -d= -f1); do
    grep -q -E "^$var=" "$ENV_FILE" || faltan="$faltan $var"
  done
  if [ -n "$faltan" ]; then
    error "A infra/.env le faltan variables:$faltan"
    paro "Copia esas líneas desde infra/.env.example a infra/.env y vuelve a correr bin/up.sh."
  fi
}

# leer_env VARIABLE  ->  imprime su valor en infra/.env (tolera CRLF).
leer_env() {
  grep -E "^$1=" "$ENV_FILE" | tail -n 1 | cut -d= -f2- | tr -d '\r'
}

compose() {
  docker compose -p "$PROYECTO" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

# url_de SERVICIO  ->  URL en el host, o "-" si el servicio no tiene interfaz web útil.
url_de() {
  case "$1" in
    grafana)       echo "http://localhost:$(leer_env PUERTO_GRAFANA)" ;;
    prometheus)    echo "http://localhost:$(leer_env PUERTO_PROMETHEUS)" ;;
    alertmanager)  echo "http://localhost:$(leer_env PUERTO_ALERTMANAGER)" ;;
    pushgateway)   echo "http://localhost:$(leer_env PUERTO_PUSHGATEWAY)" ;;
    node-exporter) echo "http://localhost:$(leer_env PUERTO_NODE_EXPORTER)/metrics" ;;
    loki)          echo "http://localhost:$(leer_env PUERTO_LOKI)/ready" ;;
    tempo)         echo "http://localhost:$(leer_env PUERTO_TEMPO)/ready" ;;
    alloy)         echo "http://localhost:$(leer_env PUERTO_ALLOY)" ;;
    otelcol)       echo "OTLP http://localhost:$(leer_env PUERTO_OTLP_HTTP)" ;;
    mailpit)       echo "http://localhost:$(leer_env PUERTO_MAILPIT_UI)" ;;
    catalogo)      echo "http://localhost:$(leer_env PUERTO_CATALOGO)/productos" ;;
    pedidos)       echo "http://localhost:$(leer_env PUERTO_PEDIDOS)/pedidos" ;;
    pagos)         echo "http://localhost:$(leer_env PUERTO_PAGOS)/salud" ;;
    catalogo-dev)  echo "http://localhost:$(leer_env PUERTO_CATALOGO_DEV)/productos" ;;
    pedidos-dev)   echo "http://localhost:$(leer_env PUERTO_PEDIDOS_DEV)/pedidos" ;;
    *)             echo "-" ;;
  esac
}

# puertos_de SERVICIO  ->  puertos del host que publica, separados por coma.
puertos_de() {
  case "$1" in
    grafana)       leer_env PUERTO_GRAFANA ;;
    prometheus)    leer_env PUERTO_PROMETHEUS ;;
    alertmanager)  leer_env PUERTO_ALERTMANAGER ;;
    pushgateway)   leer_env PUERTO_PUSHGATEWAY ;;
    node-exporter) leer_env PUERTO_NODE_EXPORTER ;;
    loki)          leer_env PUERTO_LOKI ;;
    tempo)         leer_env PUERTO_TEMPO ;;
    alloy)         leer_env PUERTO_ALLOY ;;
    otelcol)       echo "$(leer_env PUERTO_OTLP_GRPC),$(leer_env PUERTO_OTLP_HTTP)" ;;
    mailpit)       echo "$(leer_env PUERTO_MAILPIT_UI),$(leer_env PUERTO_MAILPIT_SMTP)" ;;
    catalogo)      leer_env PUERTO_CATALOGO ;;
    pedidos)       leer_env PUERTO_PEDIDOS ;;
    pagos)         leer_env PUERTO_PAGOS ;;
    catalogo-dev)  leer_env PUERTO_CATALOGO_DEV ;;
    pedidos-dev)   leer_env PUERTO_PEDIDOS_DEV ;;
    *)             echo "-" ;;
  esac
}

# salud_de SERVICIO  ->  healthy | unhealthy | starting | exited | apagado ...
salud_de() {
  local id estado
  id="$(compose ps -a -q "$1" 2>/dev/null | head -n 1)"
  if [ -z "$id" ]; then
    echo "apagado"
    return
  fi
  estado="$(docker inspect --format '{{.State.Status}}' "$id" 2>/dev/null)"
  if [ "$estado" != "running" ]; then
    echo "${estado:-apagado}"
    return
  fi
  docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}sin-healthcheck{{end}}' "$id" 2>/dev/null
}

# quien_usa_puerto PUERTO  ->  imprime quién escucha en ese puerto del host; vacío si está libre.
quien_usa_puerto() {
  local puerto="$1" contenedor linea pid
  contenedor="$(docker ps --filter "publish=$puerto" --format '{{.Names}} (imagen {{.Image}})' 2>/dev/null | head -n 1)"
  if [ -n "$contenedor" ]; then
    echo "contenedor Docker $contenedor"
    return
  fi
  if command -v lsof >/dev/null 2>&1; then
    linea="$(lsof -nP -iTCP:"$puerto" -sTCP:LISTEN 2>/dev/null | awk 'NR==2 {print $1 " (PID " $2 ", usuario " $3 ")"}')"
    [ -n "$linea" ] && echo "proceso $linea"
    return
  fi
  if command -v netstat >/dev/null 2>&1; then
    # Windows (Git Bash): netstat -ano muestra el PID en la última columna.
    pid="$(netstat -ano 2>/dev/null | grep LISTENING | grep -E "[:.]${puerto}[[:space:]]" | awk '{print $NF}' | head -n 1 | tr -d '\r')"
    if [ -n "$pid" ]; then
      linea="$(MSYS_NO_PATHCONV=1 tasklist /FI "PID eq $pid" /FO CSV /NH 2>/dev/null | head -n 1 | cut -d, -f1 | tr -d '"\r')"
      echo "proceso ${linea:-desconocido} (PID $pid)"
    fi
  fi
}

# puerto_es_del_proyecto PUERTO  ->  0 si lo publica un contenedor de gpe.
puerto_es_del_proyecto() {
  [ -n "$(docker ps --filter "publish=$1" --filter "label=com.docker.compose.project=$PROYECTO" -q 2>/dev/null)" ]
}

# Revisa todos los puertos del stack. Si alguno está prohibido u ocupado por algo ajeno, PARO.
chequear_puertos() {
  local var puerto quien prohibido problemas=0
  for var in $VARS_PUERTOS; do
    puerto="$(leer_env "$var")"
    if [ -z "$puerto" ]; then
      error "Falta $var en infra/.env. Copia esa línea desde infra/.env.example."
      problemas=1
      continue
    fi
    for prohibido in $PUERTOS_PROHIBIDOS; do
      if [ "$puerto" = "$prohibido" ]; then
        error "$var=$puerto es un puerto prohibido para este proyecto."
        problemas=1
      fi
    done
    puerto_es_del_proyecto "$puerto" && continue
    quien="$(quien_usa_puerto "$puerto")"
    if [ -n "$quien" ]; then
      error "Puerto $puerto ($var) ocupado por $quien"
      problemas=1
    fi
  done
  if [ "$problemas" -ne 0 ]; then
    paro "Hay puertos en conflicto. Libera el puerto o cambia su valor en infra/.env y vuelve a correr bin/up.sh."
  fi
}
