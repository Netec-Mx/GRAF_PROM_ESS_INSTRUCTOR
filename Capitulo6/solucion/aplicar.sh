#!/usr/bin/env bash
# Práctica 6, solución. Importa el dashboard Tianguis · Multiambiente resuelto, deja su JSON en
# Capitulo6/mi-dashboard.json, busca en Tempo un pago lento y anota su trace_id en
# Capitulo6/hallazgo.md. Al final devuelve el tráfico a normal y apaga el caos, como pide la guía.
# Pide escribir SI. Sin SI no toca nada.
set -u

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source-path=SCRIPTDIR source=../../_comun/lib-practicas.sh
. "$AQUI/../../_comun/lib-practicas.sh"

HALLAZGO="$RAIZ/Capitulo6/hallazgo.md"

# traza_lenta  ->  imprime el trace_id de un pago de los últimos 15 minutos con pasarela.cobrar
# sobre 1 segundo. No imprime nada si todavía no hay ninguno.
traza_lenta() {
  local ahora
  ahora="$(date +%s)"
  curl -s --max-time 15 -G "http://localhost:$(leer_env PUERTO_TEMPO)/api/search" \
    --data-urlencode 'q={ name = "pasarela.cobrar" && duration > 1s }' \
    --data-urlencode "start=$((ahora - 900))" --data-urlencode "end=$ahora" --data-urlencode "limit=20" \
    | tr -d '\r\n' | grep -o '"traceID":"[0-9a-f]\{32\}"' | head -n 1 | cut -d'"' -f4
}
hay_traza_lenta() { [ -n "$(traza_lenta)" ]; }

exigir_stack
confirmar_cambios 6 "EL DASHBOARD TIANGUIS · MULTIAMBIENTE SE REEMPLAZA EN GRAFANA" \
  "CAPITULO6/MI-DASHBOARD.JSON Y CAPITULO6/HALLAZGO.MD SE REEMPLAZAN"

grafana_importar "$AQUI/tianguis-multiambiente.json" || paro "Grafana rechazó el dashboard Tianguis · Multiambiente."
ok "Dashboard Tianguis · Multiambiente importado"
cp "$AQUI/tianguis-multiambiente.json" "$RAIZ/Capitulo6/mi-dashboard.json" || paro "No pude copiar el JSON."
ok "Capitulo6/mi-dashboard.json con el dashboard resuelto"

info "Buscando en Tempo un pago lento"
esperar_hasta 300 "un pago lento en Tempo" hay_traza_lenta
traza="$(traza_lenta)"
git -C "$RAIZ" checkout -- Capitulo6/hallazgo.md 2>/dev/null
printf '%s\n' "$traza" >> "$HALLAZGO" || paro "No pude escribir Capitulo6/hallazgo.md."
ok "Capitulo6/hallazgo.md con la traza $traza"

"$RAIZ/bin/trafico.sh" nivel normal >/dev/null || paro "No pude dejar el tráfico en nivel normal."
"$RAIZ/bin/caos.sh" apagar >/dev/null || paro "No pude apagar las fallas de caos."
esperar_hasta 90 "que Prometheus vea el caos apagado" prom_existe 'sum(chaos_active) == 0'
ok "Solución de la Práctica 6 aplicada. Tráfico normal y sin caos"
