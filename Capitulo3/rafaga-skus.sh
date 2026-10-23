#!/usr/bin/env bash
# Práctica 3. Hace 200 peticiones a catalogo, cada una a un sku distinto. Los 20 primeros
# existen (TNG-0001 a TNG-0020) y los otros 180 no, así que la ráfaga deja respuestas 200 y
# 404. Los 180 inexistentes salen de la hora, así que cada corrida usa skus nuevos. No cambia
# nada en catalogo, solo lo consulta.
set -u

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source-path=SCRIPTDIR source=../_comun/lib-practicas.sh
. "$AQUI/../_comun/lib-practicas.sh"

[ -f "$ENV_FILE" ] || paro "No existe infra/.env. Levanta el stack con bin/up.sh."
URL="http://localhost:$(leer_env PUERTO_CATALOGO)"
curl -s -o /dev/null --max-time 5 "$URL/salud" || paro "catalogo no responde en $URL. Revisa bin/estado.sh."

# Primer sku inexistente, entre TNG-0101 y TNG-9700.
BASE=$(( $(date +%s) % 9600 + 100 ))

existentes=0
inexistentes=0
otras=0
info "Ráfaga de 200 peticiones a $URL/productos/{sku}"
for n in $(seq 1 200); do
  if [ "$n" -le 20 ]; then
    sku="$(printf 'TNG-%04d' "$n")"
  else
    sku="$(printf 'TNG-%04d' $((BASE + n - 20)))"
  fi
  codigo="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$URL/productos/$sku")"
  case "$codigo" in
    200) existentes=$((existentes + 1)) ;;
    404) inexistentes=$((inexistentes + 1)) ;;
    *) otras=$((otras + 1)) ;;
  esac
  if [ $((n % 50)) -eq 0 ]; then
    printf '%s\n' "    $n peticiones"
  fi
done

ok "Ráfaga terminada. $existentes respuestas 200, $inexistentes respuestas 404 y $otras de otro tipo."
echo "    Prometheus las verá en su próximo scrape, dentro de 15 segundos."
