#!/usr/bin/env bash
# Práctica 3, solución. Copia las consultas resueltas sobre Capitulo3/consultas.md y deja el caos
# apagado, como queda al final de la práctica. Pide escribir SI. Sin SI no toca nada.
set -u

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source-path=SCRIPTDIR source=../../_comun/lib-practicas.sh
. "$AQUI/../../_comun/lib-practicas.sh"

exigir_stack
confirmar_cambios 3 "CAPITULO3/CONSULTAS.MD SE REEMPLAZA CON LAS CONSULTAS RESUELTAS"

cp "$AQUI/consultas.md" "$RAIZ/Capitulo3/consultas.md" || paro "No pude copiar consultas.md."
ok "Capitulo3/consultas.md resuelto"

"$RAIZ/bin/caos.sh" apagar >/dev/null || paro "No pude apagar las fallas de caos."
esperar_hasta 90 "que Prometheus vea el caos apagado" prom_existe 'sum(chaos_active{job=~"catalogo|pedidos"}) == 0'
ok "Solución de la Práctica 3 aplicada"
