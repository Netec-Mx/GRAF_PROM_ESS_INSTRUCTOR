#!/usr/bin/env bash
# Práctica 7. Deja el stack base en el punto de partida: todo arriba sin la capa de seguridad,
# tráfico en nivel normal y ninguna falla de caos. Avisa si quedan restos de una corrida anterior.
set -u

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source-path=SCRIPTDIR source=../_comun/lib-practicas.sh
. "$AQUI/../_comun/lib-practicas.sh"

command -v openssl >/dev/null 2>&1 || paro "No encuentro openssl. En Windows viene con Git Bash."

"$RAIZ/bin/up.sh" >/dev/null 2>&1 || paro "El stack no levantó. Corre bin/up.sh y revisa su mensaje."
"$RAIZ/bin/trafico.sh" nivel normal >/dev/null || paro "No pude dejar el tráfico en nivel normal."
"$RAIZ/bin/caos.sh" apagar >/dev/null || paro "No pude apagar las fallas de caos. Revisa bin/caos.sh estado."

if [ -d "$AQUI/trabajo" ] || ! git -C "$RAIZ" diff --quiet -- Capitulo7/compose.seguridad.yaml 2>/dev/null; then
  aviso "Quedan archivos de una corrida anterior en Capitulo7/trabajo o en compose.seguridad.yaml."
  echo "    Para empezar desde cero corre Capitulo7/restaurar.sh."
fi

ok "Punto de partida de la Práctica 7 listo. Stack base arriba, sin capa de seguridad."
echo "    openssl $(openssl version | cut -d' ' -f2)"
