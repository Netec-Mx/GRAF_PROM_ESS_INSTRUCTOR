#!/usr/bin/env bash
# Práctica 9. Deja el stack base en el punto de partida: todo arriba sin capas de otras
# prácticas, tráfico en nivel normal y ninguna falla de caos encendida.
set -u

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source-path=SCRIPTDIR source=../_comun/lib-practicas.sh
. "$AQUI/../_comun/lib-practicas.sh"

if [ -d "$RAIZ/Capitulo7/trabajo" ]; then
  aviso "Queda Capitulo7/trabajo de la Práctica 7. bin/up.sh baja su capa de seguridad igual."
fi

"$RAIZ/bin/up.sh" >/dev/null 2>&1 || paro "El stack no levantó. Corre bin/up.sh y revisa su mensaje."
"$RAIZ/bin/trafico.sh" nivel normal >/dev/null || paro "No pude dejar el tráfico en nivel normal."
"$RAIZ/bin/caos.sh" apagar >/dev/null || paro "No pude apagar las fallas de caos. Revisa bin/caos.sh estado."

if ! git -C "$RAIZ" diff --quiet -- Capitulo9 2>/dev/null || [ -d "$AQUI/respaldo" ]; then
  aviso "Hay cambios de una corrida anterior en Capitulo9."
  echo "    Para empezar desde cero corre Capitulo9/restaurar.sh."
fi

ok "Punto de partida de la Práctica 9 listo. Grafana en http://localhost:$(leer_env PUERTO_GRAFANA)"
