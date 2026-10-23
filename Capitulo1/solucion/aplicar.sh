#!/usr/bin/env bash
# Práctica 1, solución. Copia las dos tablas resueltas sobre Capitulo1/mapa-de-senales.md.
# Pide escribir SI. Sin SI no toca nada.
set -u

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source-path=SCRIPTDIR source=../../_comun/lib-practicas.sh
. "$AQUI/../../_comun/lib-practicas.sh"

confirmar_cambios 1 "CAPITULO1/MAPA-DE-SENALES.MD SE REEMPLAZA CON LAS TABLAS RESUELTAS"

cp "$AQUI/mapa-de-senales.md" "$RAIZ/Capitulo1/mapa-de-senales.md" || paro "No pude copiar mapa-de-senales.md."
ok "Capitulo1/mapa-de-senales.md resuelto"
