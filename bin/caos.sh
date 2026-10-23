#!/usr/bin/env bash
# Enciende y apaga las fallas de caos de Tianguis Digital. Es la interfaz única para clase.
#
#   bin/caos.sh estado                        tabla de todas las fallas de todos los servicios
#   bin/caos.sh <servicio> <tipo> [k=v ...]   activa una falla
#   bin/caos.sh <servicio> <tipo> off         apaga una falla
#   bin/caos.sh apagar                        apaga todo en los cuatro
#
# catalogo, pedidos y pagos se controlan por HTTP (rutas /caos, con el token de infra/.env).
# catalogo-dev y pedidos-dev son los mismos servicios en el ambiente dev: mismas fallas.
# conciliacion no tiene HTTP: se controla con docker exec dentro de su contenedor.
set -u

. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

SERVICIOS_HTTP="catalogo pedidos pagos catalogo-dev pedidos-dev"
CONTENEDOR_CONCILIACION="gpe-conciliacion"
ESPERA_HTTP=10   # segundos

uso() {
  cat <<'FIN'
Uso:
  bin/caos.sh estado
  bin/caos.sh <servicio> <tipo> [k=v ...]
  bin/caos.sh <servicio> <tipo> off
  bin/caos.sh apagar

Servicios: catalogo, pedidos, pagos, conciliacion, y en el ambiente dev catalogo-dev y
pedidos-dev, con las mismas fallas que catalogo y pedidos.

Fallas:
  catalogo, pedidos   latencia      ms=1..10000 [jitter_ms=0..5000] [porcentaje=1..100] [ruta=PLANTILLA]
                      errores       [porcentaje=1..100] [status=500|502|503|504] [ruta=PLANTILLA]
                      cardinalidad  (sin parámetros)
                      memoria       mb_por_minuto=1..200
  pagos               pasarela_lenta    ms=100..10000 [porcentaje=1..100] [metodo=tarjeta|oxxo|spei]
                      pasarela_errores  [porcentaje=1..100] [metodo=tarjeta|oxxo|spei]
  conciliacion        fallar        (sin parámetros)

Todas aceptan duracion_s=1..86400: al cumplirse, la falla se apaga sola.

Ejemplos:
  bin/caos.sh pedidos latencia ms=800 jitter_ms=200 porcentaje=100 duracion_s=600
  bin/caos.sh catalogo cardinalidad
  bin/caos.sh pagos pasarela_lenta ms=1500 porcentaje=30
  bin/caos.sh conciliacion fallar duracion_s=900
  bin/caos.sh pedidos latencia off
  bin/caos.sh catalogo-dev errores porcentaje=50
FIN
}

es_http() {
  case " $SERVICIOS_HTTP " in *" $1 "*) return 0 ;; *) return 1 ;; esac
}

# campo JSON NOMBRE  ->  valor de un campo de texto del JSON, sin comillas.
campo() {
  printf '%s' "$1" | sed -n 's/.*"'"$2"'": *"\([^"]*\)".*/\1/p'
}

# pedir SERVICIO METODO RUTA [CUERPO]
# Deja el código HTTP en CODIGO y la respuesta en CUERPO. Devuelve 1 si no hubo respuesta.
pedir() {
  local servicio="$1" metodo="$2" ruta="$3" datos="${4:-}" salida
  local url="http://127.0.0.1:$(puertos_de "$servicio")$ruta"
  CODIGO=""; CUERPO=""
  if [ -n "$datos" ]; then
    salida="$(curl -sS -m "$ESPERA_HTTP" -X "$metodo" -H "X-Caos-Token: $TOKEN" \
      -H 'Content-Type: application/json' -d "$datos" -w '\n%{http_code}' "$url" 2>/dev/null)" || return 1
  else
    salida="$(curl -sS -m "$ESPERA_HTTP" -X "$metodo" -H "X-Caos-Token: $TOKEN" \
      -w '\n%{http_code}' "$url" 2>/dev/null)" || return 1
  fi
  CODIGO="${salida##*$'\n'}"
  CUERPO="${salida%$'\n'*}"
  return 0
}

# Explica por qué un servicio HTTP no hizo lo pedido, según CODIGO y CUERPO.
explicar() {
  local servicio="$1" mensaje
  case "$CODIGO" in
    "")
      error "$servicio no responde en http://localhost:$(puertos_de "$servicio"). ¿Está arriba? Revisa con bin/estado.sh." ;;
    401)
      error "$servicio rechazó el token. El contenedor arrancó con un CAOS_TOKEN distinto al de infra/.env."
      echo "      Corre bin/up.sh para que tome el valor actual." >&2 ;;
    404)
      if [ "$(campo "$CUERPO" error)" = "falla_desconocida" ]; then
        error "$(campo "$CUERPO" mensaje). Mira las fallas de cada servicio con: bin/caos.sh"
      else
        error "$servicio no tiene /caos: arrancó con CAOS_TOKEN vacío, así que el caos está deshabilitado."
        echo "      Pon un valor en CAOS_TOKEN de infra/.env y corre bin/up.sh." >&2
      fi ;;
    400|413)
      mensaje="$(campo "$CUERPO" mensaje)"
      error "$servicio no aceptó los parámetros: ${mensaje:-$CUERPO}" ;;
    *)
      error "$servicio respondió $CODIGO: $CUERPO" ;;
  esac
}

# en_conciliacion ARGUMENTOS...  ->  corre el control de caos dentro del contenedor.
# Deja la salida en CUERPO. Devuelve 1 si no se pudo, ya con el motivo explicado.
en_conciliacion() {
  local codigo errores
  CUERPO=""
  if [ "$(docker inspect --format '{{.State.Status}}' "$CONTENEDOR_CONCILIACION" 2>/dev/null)" != "running" ]; then
    error "conciliacion no está corriendo ($CONTENEDOR_CONCILIACION). Revisa con bin/estado.sh."
    return 1
  fi
  # La salida de error se junta con la normal: si falla, trae el motivo en JSON.
  CUERPO="$(docker exec "$CONTENEDOR_CONCILIACION" python -m conciliacion.caos "$@" 2>&1)"
  codigo=$?
  case "$codigo" in
    0) return 0 ;;
    2) errores="$(campo "$CUERPO" mensaje)"
       error "conciliacion no aceptó los parámetros: ${errores:-$CUERPO}" ;;
    3) error "conciliacion tiene el caos deshabilitado: arrancó con CAOS_TOKEN vacío."
       echo "      Pon un valor en CAOS_TOKEN de infra/.env y corre bin/up.sh." >&2 ;;
    *) error "conciliacion no pudo cambiar el caos: $CUERPO" ;;
  esac
  return 1
}

encabezado() {
  printf '%s%-13s %-17s %-8s %-9s %s%s\n' "$NEGRITA" "SERVICIO" "FALLA" "ESTADO" "RESTANTE" "PARAMETROS" "$NORMAL"
}

# filas SERVICIO JSON  ->  una fila de la tabla por cada falla que traiga el JSON.
filas() {
  local servicio="$1" linea tipo estado color restante parametros
  # Cada falla empieza con {"tipo": se parte ahí para dejar una por línea.
  printf '%s\n' "$2" | sed 's/{"tipo"/\
{"tipo"/g' | grep '^{"tipo"' | while IFS= read -r linea; do
    tipo="$(printf '%s' "$linea" | sed 's/^{"tipo":"\([^"]*\)".*/\1/')"
    case "$linea" in
      *'"activa":true'*) estado="ACTIVA";  color="$ROJO" ;;
      *)                 estado="apagada"; color="$VERDE" ;;
    esac
    restante="$(printf '%s' "$linea" | sed -n 's/.*"restante_s":\([0-9][0-9]*\).*/\1/p')"
    [ -n "$restante" ] && restante="${restante} s"
    # parametros es el último campo: se le quita lo de adelante y las llaves de cierre.
    parametros="$(printf '%s' "$linea" | sed 's/.*"parametros":{//; s/}}[],}]*$//; s/"//g; s/:/=/g; s/,/ /g')"
    # El relleno se calcula antes de colorear para que la tabla no se descuadre.
    printf '%-13s %-17s %s %-9s %s\n' "$servicio" "$tipo" \
      "${color}$(printf '%-8s' "$estado")${NORMAL}" "${restante:--}" "${parametros:--}"
  done
}

# Muestra las fallas de un servicio. Devuelve 1 si no se pudo consultar.
estado_de() {
  local servicio="$1"
  if es_http "$servicio"; then
    if ! pedir "$servicio" GET /caos || [ "$CODIGO" != "200" ]; then
      explicar "$servicio"
      return 1
    fi
  else
    en_conciliacion estado || return 1
  fi
  filas "$servicio" "$CUERPO"
}

estado_de_todos() {
  local servicio problemas=0
  encabezado
  for servicio in $SERVICIOS_HTTP conciliacion; do
    estado_de "$servicio" || problemas=1
  done
  return "$problemas"
}

apagar_todo() {
  local servicio problemas=0
  for servicio in $SERVICIOS_HTTP; do
    if pedir "$servicio" DELETE /caos && [ "$CODIGO" = "200" ]; then
      ok "$servicio: todo apagado"
    else
      explicar "$servicio"
      problemas=1
    fi
  done
  if en_conciliacion apagar; then
    ok "conciliacion: todo apagado"
  else
    problemas=1
  fi
  echo
  estado_de_todos || problemas=1
  return "$problemas"
}

# cuerpo_json k=v ...  ->  imprime el objeto JSON con esos parámetros.
# Un valor de solo dígitos va como número; cualquier otro, como texto.
cuerpo_json() {
  local par clave valor json=""
  for par in "$@"; do
    case "$par" in
      *=*) ;;
      *) error "No entiendo \"$par\": los parámetros van como clave=valor."; return 1 ;;
    esac
    clave="${par%%=*}"
    valor="${par#*=}"
    if ! printf '%s' "$clave" | grep -q -E '^[a-z_]+$'; then
      error "Nombre de parámetro inválido: \"$clave\"."
      return 1
    fi
    if printf '%s' "$valor" | grep -q -E '^[0-9]+$'; then
      json="$json,\"$clave\":$valor"
    elif printf '%s' "$valor" | grep -q -E '^[A-Za-z0-9_/{}.-]+$'; then
      json="$json,\"$clave\":\"$valor\""
    else
      error "Valor inválido para $clave: \"$valor\"."
      return 1
    fi
  done
  printf '{%s}' "${json#,}"
}

# cambiar SERVICIO TIPO [off | k=v ...]
cambiar() {
  local servicio="$1" tipo="$2" datos
  shift 2
  if [ "$servicio" = "conciliacion" ]; then
    en_conciliacion "$tipo" "$@" || return 1
  elif [ "${1:-}" = "off" ] && [ $# -eq 1 ]; then
    if ! pedir "$servicio" DELETE "/caos/$tipo" || [ "$CODIGO" != "200" ]; then
      explicar "$servicio"
      return 1
    fi
  else
    datos="$(cuerpo_json "$@")" || return 1
    if ! pedir "$servicio" PUT "/caos/$tipo" "$datos" || [ "$CODIGO" != "200" ]; then
      explicar "$servicio"
      return 1
    fi
  fi
  encabezado
  filas "$servicio" "$CUERPO" | grep -E "^$servicio +$tipo "
  echo
  if [ "${1:-}" = "off" ]; then
    ok "$servicio: $tipo apagada"
  else
    ok "$servicio: $tipo activa. Para apagarla: bin/caos.sh $servicio $tipo off"
  fi
}

case "${1:-}" in
  ""|-h|--help|ayuda)
    uso
    [ $# -eq 0 ] && exit 2
    exit 0 ;;
esac

chequear_docker
asegurar_env
TOKEN="$(leer_env CAOS_TOKEN)"

case "$1" in
  estado)
    [ $# -eq 1 ] || { uso >&2; exit 2; }
    estado_de_todos ;;
  apagar)
    [ $# -eq 1 ] || { uso >&2; exit 2; }
    apagar_todo ;;
  catalogo|pedidos|pagos|conciliacion|catalogo-dev|pedidos-dev)
    [ $# -ge 2 ] || { uso >&2; exit 2; }
    if ! printf '%s' "$2" | grep -q -E '^[a-z_]+$'; then
      error "Nombre de falla inválido: \"$2\"."
      exit 2
    fi
    cambiar "$@" ;;
  *)
    error "No conozco el servicio \"$1\". Los servicios con caos son: $SERVICIOS_HTTP conciliacion."
    exit 2 ;;
esac
