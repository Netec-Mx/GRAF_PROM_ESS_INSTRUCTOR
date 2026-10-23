#!/usr/bin/env bash
# Práctica 3. Deja el stack en el punto de partida: todo arriba, tráfico en nivel normal, todas
# las fallas de caos apagadas y catalogo recién reiniciado, para que sus series partan limpias.
set -u

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source-path=SCRIPTDIR source=../_comun/lib-practicas.sh
. "$AQUI/../_comun/lib-practicas.sh"

ESPERA_MAX=90   # segundos

"$RAIZ/bin/up.sh" >/dev/null 2>&1 || paro "El stack no levantó. Corre bin/up.sh y revisa su mensaje."
"$RAIZ/bin/trafico.sh" nivel normal >/dev/null || paro "No pude dejar el tráfico en nivel normal."
"$RAIZ/bin/caos.sh" apagar >/dev/null || paro "No pude apagar las fallas de caos. Revisa bin/caos.sh estado."

if [ -f "$AQUI/consultas.md" ] && tr -d '\r' < "$AQUI/consultas.md" | awk '
    /^```promql/ { dentro = 1; next }
    /^```/       { dentro = 0; next }
    dentro && NF { escrito = 1 }
    END          { exit !escrito }'; then
  aviso "Capitulo3/consultas.md ya tiene respuestas. Si repites la práctica, puedes borrarlas a mano."
fi

docker restart gpe-catalogo >/dev/null || paro "No pude reiniciar gpe-catalogo."

inicio=$(date +%s)
until [ "$(contenedor_salud gpe-catalogo)" = "healthy" ] && prom_existe 'up{job="catalogo", ambiente="prod"} == 1'; do
  if [ $(( $(date +%s) - inicio )) -ge "$ESPERA_MAX" ]; then
    paro "Pasaron ${ESPERA_MAX}s y catalogo no volvió. Revisa bin/estado.sh."
  fi
  sleep 3
done

ok "Punto de partida de la Práctica 3 listo"
