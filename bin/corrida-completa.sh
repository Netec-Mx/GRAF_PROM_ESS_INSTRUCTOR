#!/usr/bin/env bash
# Corre las prácticas una tras otra como las haría el alumno, con la solución de cada una.
#
#   bin/corrida-completa.sh            de la Práctica 1 a la 9
#   bin/corrida-completa.sh 5          de la 5 a la 9
#   bin/corrida-completa.sh 3 4        solo la 3 y la 4
#
# Para cada práctica corre preparar.sh, aplica la solución con solucion/aplicar.sh, corre
# verificar.sh, que tiene que quedar todo en verde, corre restaurar.sh y revisa que bin/estado.sh y
# los archivos del repositorio queden igual que al empezar. Si algo falla se detiene y dice dónde.
# Al final muestra una tabla con el tiempo de cada paso y la RAM máxima que usó el stack.
#
# Pisa los archivos de trabajo de todas las prácticas y lo que se hizo a mano en Grafana. Pide
# escribir SI. Para correrla sin preguntar, printf 'SI\n' | bin/corrida-completa.sh
# El registro completo queda en corrida/FECHA/, que git ignora. Tarda unos 30 minutos en macOS y unos 40 en Windows.
set -u

BIN="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source-path=SCRIPTDIR source=../_comun/lib-practicas.sh
. "$BIN/../_comun/lib-practicas.sh"

DESDE="${1:-1}"
HASTA="${2:-9}"
ESPERA_SANO=300   # segundos que se espera a que bin/estado.sh quede todo en healthy
REGISTRO="$RAIZ/corrida/$(date +%Y%m%d-%H%M%S)"
RESUMEN="$REGISTRO/resumen.txt"
RAM_MAX="$REGISTRO/ram-max"
FILAS=""
MUESTREO=""

case "$DESDE$HASTA" in
  *[!0-9]*) paro "Uso: bin/corrida-completa.sh [DESDE] [HASTA], con números del 1 al 9." ;;
esac
[ "$DESDE" -ge 1 ] && [ "$HASTA" -le 9 ] && [ "$DESDE" -le "$HASTA" ] \
  || paro "Uso: bin/corrida-completa.sh [DESDE] [HASTA], con números del 1 al 9."

# --- Medidas ---------------------------------------------------------------------------------

# duracion SEGUNDOS  ->  el tiempo como m:ss.
duracion() { printf '%d:%02d' $(($1 / 60)) $(($1 % 60)); }

# ram_ahora  ->  MiB que usan entre todos los contenedores del proyecto en este momento.
ram_ahora() {
  docker stats --no-stream --format '{{.Name}} {{.MemUsage}}' 2>/dev/null | awk '
    $1 ~ /^gpe-/ {
      v = $2; n = v + 0; u = v; sub(/^[0-9.]+/, "", u)
      if (u == "GiB") n *= 1024; else if (u == "KiB") n /= 1024; else if (u == "B") n /= 1048576
      total += n
    }
    END { printf "%d\n", total }'
}

# muestrear  ->  cada 15 segundos anota en RAM_MAX el máximo visto. Corre en segundo plano.
muestrear() {
  local ahora maximo
  while :; do
    ahora="$(ram_ahora)"
    maximo="$(cat "$RAM_MAX" 2>/dev/null)"
    [ "${ahora:-0}" -gt "${maximo:-0}" ] && echo "$ahora" > "$RAM_MAX"
    sleep 15
  done
}

terminar() {
  [ -n "$MUESTREO" ] && kill "$MUESTREO" 2>/dev/null
  MUESTREO=""
}
trap terminar EXIT
trap 'terminar; exit 130' INT TERM

# --- Estado base -----------------------------------------------------------------------------

# foto_estado  ->  la tabla de bin/estado.sh sin colores.
foto_estado() { NO_COLOR=1 "$RAIZ/bin/estado.sh" 2>&1; }

# foto_git  ->  los archivos que difieren de git, sin contar los que git ignora.
foto_git() { git -C "$RAIZ" status --porcelain 2>/dev/null; }

# esperar_sano  ->  0 si bin/estado.sh queda todo en healthy antes de ESPERA_SANO segundos.
esperar_sano() {
  local inicio
  inicio=$(date +%s)
  until "$RAIZ/bin/estado.sh" >/dev/null 2>&1; do
    [ $(( $(date +%s) - inicio )) -lt "$ESPERA_SANO" ] || return 1
    sleep 5
  done
}

# --- Resumen ---------------------------------------------------------------------------------

tabla() {
  local maximo
  maximo="$(cat "$RAM_MAX" 2>/dev/null)"
  {
    echo
    # Escrita a mano: printf cuenta bytes y las letras con tilde descuadran las columnas.
    echo "PRÁCTICA  PREPARAR  SOLUCIÓN  VERIFICAR RESTAURAR TOTAL     RESULTADO"
    printf '%s' "$FILAS"
    echo
    echo "Corrida completa en $(duracion $(( $(date +%s) - INICIO_CORRIDA )))"
    if [ -n "$maximo" ]; then
      echo "RAM máxima del stack $maximo MiB, medida cada 15 segundos con docker stats"
    fi
    echo "Grafana en el puerto $(leer_env PUERTO_GRAFANA), Prometheus en el $(leer_env PUERTO_PROMETHEUS)"
    echo "Registro completo en ${REGISTRO#"$RAIZ"/}"
  } | tee -a "$RESUMEN"
}

# fallar N PASO DETALLE  ->  anota la fila de la práctica que falló, muestra la tabla y sale con 1.
fallar() {
  FILAS="$FILAS$(printf '%-9s %s\n' "$1" "falló en $2")
"
  echo
  error "La Práctica $1 falló en $2."
  [ -n "${3:-}" ] && printf '%s\n' "$3" >&2
  echo "    Registro de la práctica en ${REGISTRO#"$RAIZ"/}/practica-$1.log" >&2
  tabla
  exit 1
}

# paso N NOMBRE COMANDO...  ->  corre un paso de la práctica N con su salida al registro. Deja en
# T_PASO los segundos que tardó. Devuelve el código del comando.
paso() {
  local n="$1" nombre="$2" inicio rc
  shift 2
  inicio=$(date +%s)
  printf '\n===== %s  %s\n' "$nombre" "$(date +%H:%M:%S)" >> "$REGISTRO/practica-$n.log"
  "$@" >> "$REGISTRO/practica-$n.log" 2>&1
  rc=$?
  T_PASO=$(( $(date +%s) - inicio ))
  printf '===== %s terminó con código %s en %s\n' "$nombre" "$rc" "$(duracion "$T_PASO")" >> "$REGISTRO/practica-$n.log"
  return "$rc"
}

con_si() { printf 'SI\n' | "$@"; }

# --- Corrida ---------------------------------------------------------------------------------

chequear_docker
asegurar_env
command -v git >/dev/null 2>&1 || paro "No encuentro git en el PATH."

echo "${ROJO}${NEGRITA}"
echo "============================================================"
echo "  SE VAN A CORRER LAS PRÁCTICAS $DESDE A $HASTA CON SU SOLUCIÓN"
echo "    LOS ARCHIVOS DE TRABAJO DE CADA PRÁCTICA SE REEMPLAZAN Y DESPUÉS"
echo "    VUELVEN A GIT. GRAFANA QUEDA CON LOS DASHBOARDS DE LAS SOLUCIONES."
echo "============================================================"
echo "  SE PIERDE LO QUE HAYAS HECHO EN ESAS PRÁCTICAS."
echo "  TARDA UNOS 30 MINUTOS. NO HAY VUELTA ATRÁS."
echo "============================================================"
echo "${NORMAL}"
if ! confirmar_si; then
  echo
  ok "No se confirmó. No se tocó nada."
  exit 0
fi

mkdir -p "$REGISTRO" || paro "No pude crear ${REGISTRO#"$RAIZ"/}."
INICIO_CORRIDA=$(date +%s)
muestrear &
MUESTREO=$!

info "Levantando el stack base"
"$RAIZ/bin/up.sh" > "$REGISTRO/inicio.log" 2>&1 || paro "bin/up.sh falló. Mira ${REGISTRO#"$RAIZ"/}/inicio.log."
esperar_sano || paro "El stack no quedó healthy. Revisa bin/estado.sh."
foto_estado > "$REGISTRO/estado-base.txt"
foto_git > "$REGISTRO/git-base.txt"
ok "Stack base healthy. Grafana en $(url_de grafana), Prometheus en $(url_de prometheus)"

n="$DESDE"
while [ "$n" -le "$HASTA" ]; do
  capitulo="$RAIZ/Capitulo$n"
  inicio=$(date +%s)
  info "Práctica $n"

  paso "$n" preparar "$capitulo/preparar.sh" || fallar "$n" "preparar.sh" "$(tail -n 5 "$REGISTRO/practica-$n.log")"
  t_preparar=$T_PASO
  paso "$n" solución con_si "$capitulo/solucion/aplicar.sh" \
    || fallar "$n" "solucion/aplicar.sh" "$(tail -n 5 "$REGISTRO/practica-$n.log")"
  t_solucion=$T_PASO
  paso "$n" verificar "$capitulo/verificar.sh" > /dev/null
  rc=$?
  t_verificar=$T_PASO
  if [ "$rc" -ne 0 ]; then
    fallar "$n" "verificar.sh" "$(grep -A1 'FALTA' "$REGISTRO/practica-$n.log")"
  fi
  ok "Práctica $n verificada, $(grep -o '[0-9]* de [0-9]* verificaciones en verde' "$REGISTRO/practica-$n.log" | tail -n 1)"
  paso "$n" restaurar con_si "$capitulo/restaurar.sh" || fallar "$n" "restaurar.sh" "$(tail -n 5 "$REGISTRO/practica-$n.log")"
  t_restaurar=$T_PASO

  esperar_sano || fallar "$n" "bin/estado.sh" "El stack no volvió a quedar healthy después de restaurar.sh."
  foto_estado > "$REGISTRO/estado-$n.txt"
  if ! diff "$REGISTRO/estado-base.txt" "$REGISTRO/estado-$n.txt" > "$REGISTRO/estado-$n.diff"; then
    fallar "$n" "bin/estado.sh" "El estado no quedó igual al base. Diferencias en ${REGISTRO#"$RAIZ"/}/estado-$n.diff"
  fi
  foto_git > "$REGISTRO/git-$n.txt"
  if ! diff "$REGISTRO/git-base.txt" "$REGISTRO/git-$n.txt" > "$REGISTRO/git-$n.diff"; then
    fallar "$n" "git status" "Quedaron archivos distintos de git. Diferencias en ${REGISTRO#"$RAIZ"/}/git-$n.diff"
  fi

  total=$(( $(date +%s) - inicio ))
  FILAS="$FILAS$(printf '%-9s %-9s %-9s %-9s %-9s %-9s %s\n' "$n" "$(duracion "$t_preparar")" \
    "$(duracion "$t_solucion")" "$(duracion "$t_verificar")" "$(duracion "$t_restaurar")" "$(duracion "$total")" "en verde")
"
  ok "Práctica $n completa en $(duracion "$total"). Stack y repositorio igual que al empezar"
  n=$((n + 1))
done

terminar
echo
ok "Las prácticas $DESDE a $HASTA corrieron en verde"
tabla
