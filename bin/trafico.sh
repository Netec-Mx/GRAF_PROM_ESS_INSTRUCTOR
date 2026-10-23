#!/usr/bin/env bash
# Controla en vivo la clientela de la tienda: el k6 que corre en gpe-k6.
#
#   bin/trafico.sh estado            clientes actuales, si está pausado e iteraciones
#   bin/trafico.sh pausar            deja de mandar tráfico
#   bin/trafico.sh reanudar          vuelve a mandar tráfico
#   bin/trafico.sh nivel <nombre>    bajo (2), normal (5), alto (20) o buenfin (40)
#   bin/trafico.sh nivel <número>    ese número exacto de clientes, de 1 a 60
#
# k6 no publica ningún puerto: todo se hace con docker exec dentro de su contenedor.
set -u

. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

CONTENEDOR="gpe-k6"
TOPE=60   # clientes como máximo. Es el mismo tope que tiene servicios/trafico/trafico.js.

uso() {
  cat <<'FIN'
Uso:
  bin/trafico.sh estado
  bin/trafico.sh pausar
  bin/trafico.sh reanudar
  bin/trafico.sh nivel <nombre>     bajo (2 clientes), normal (5), alto (20), buenfin (40)
  bin/trafico.sh nivel <número>     de 1 a 60 clientes

Cada cliente hace una petición cada 0.5 a 2 segundos, así que 5 clientes son unas 4 peticiones
por segundo entre todos los servicios.
FIN
}

# clientes_de NIVEL  ->  cuántos clientes es ese nivel; vacío si el nombre no existe.
clientes_de() {
  case "$1" in
    bajo)    echo 2 ;;
    normal)  echo 5 ;;
    alto)    echo 20 ;;
    buenfin) echo 40 ;;
  esac
}

# nombre_de CLIENTES  ->  el nombre del nivel, si ese número es uno de los niveles.
nombre_de() {
  case "$1" in
    2)  echo " (nivel bajo)" ;;
    5)  echo " (nivel normal)" ;;
    20) echo " (nivel alto)" ;;
    40) echo " (nivel buenfin)" ;;
  esac
}

# k6 ORDEN...  ->  corre una orden de k6 dentro del contenedor y deja su salida en SALIDA.
k6() {
  SALIDA="$(docker exec "$CONTENEDOR" k6 "$@" 2>&1)" && return 0
  error "k6 no aceptó la orden: $SALIDA"
  return 1
}

# dato NOMBRE  ->  valor de ese campo en la salida de k6 status, sin comillas.
dato() {
  printf '%s\n' "$SALIDA" | tr -d '\r' | sed -n 's/^'"$1"': *"\{0,1\}\([^"]*\)"\{0,1\}$/\1/p' | head -n 1
}

mostrar_estado() {
  local clientes pausado iteraciones
  k6 status || return 1
  clientes="$(dato vus)"
  pausado="$(dato paused)"

  # k6 stats lista todas las métricas; las iteraciones van en el bloque "name: iterations".
  iteraciones="$(docker exec "$CONTENEDOR" k6 stats 2>/dev/null | tr -d '\r' \
    | awk '/^- name: /{dentro = ($3 == "iterations")} dentro && $1 == "count:" {print $2; exit}')"

  if [ "$pausado" = "true" ]; then
    printf '%s\n' "Tráfico      ${AMARILLO}PAUSADO${NORMAL}"
    # En pausa k6 informa 0 clientes. Al reanudar vuelven los que había, o los del último nivel pedido.
    echo "Clientes     0 mientras dure la pausa, tope $TOPE"
  else
    printf '%s\n' "Tráfico      ${VERDE}corriendo${NORMAL}"
    echo "Clientes     ${clientes}$(nombre_de "$clientes"), tope $TOPE"
  fi
  echo "Iteraciones  ${iteraciones:-0} recorridos terminados desde que arrancó k6"
}

[ $# -ge 1 ] || { uso; exit 2; }
case "$1" in
  -h|--help|ayuda) uso; exit 0 ;;
esac

chequear_docker
if [ "$(docker inspect --format '{{.State.Status}}' "$CONTENEDOR" 2>/dev/null)" != "running" ]; then
  paro "$CONTENEDOR no está corriendo. Levanta el stack con bin/up.sh."
fi

case "$1" in
  estado)
    [ $# -eq 1 ] || { uso >&2; exit 2; }
    mostrar_estado ;;
  pausar)
    [ $# -eq 1 ] || { uso >&2; exit 2; }
    k6 pause || exit 1
    ok "Tráfico pausado. Para volver: bin/trafico.sh reanudar"
    mostrar_estado ;;
  reanudar)
    [ $# -eq 1 ] || { uso >&2; exit 2; }
    k6 resume || exit 1
    ok "Tráfico reanudado"
    mostrar_estado ;;
  nivel)
    [ $# -eq 2 ] || { uso >&2; exit 2; }
    clientes="$(clientes_de "$2")"
    if [ -z "$clientes" ]; then
      if ! printf '%s' "$2" | grep -q -E '^[0-9]{1,3}$'; then
        error "No conozco el nivel \"$2\". Usa bajo, normal, alto, buenfin o un número de 1 a $TOPE."
        exit 2
      fi
      # Con 10# un número como 08 no se toma por octal.
      clientes=$((10#$2))
      if [ "$clientes" -lt 1 ] || [ "$clientes" -gt "$TOPE" ]; then
        error "El número de clientes va de 1 a $TOPE. Para dejar la tienda sin tráfico: bin/trafico.sh pausar"
        exit 2
      fi
    fi
    k6 scale --vus "$clientes" || exit 1
    ok "Nivel de tráfico cambiado"
    mostrar_estado ;;
  *)
    uso >&2
    exit 2 ;;
esac
