#!/usr/bin/env bash
# Práctica 9. Baja la capa de escala y deja el stack base como estaba antes de la práctica.
# Vuelve a levantar el stack sin compose.escala.yaml, borra los contenedores y volúmenes de la
# capa, devuelve los archivos de Capitulo9 a git y borra el respaldo y la clave de PostgreSQL. La
# organización, el equipo y la carpeta de la práctica viven en PostgreSQL y se van con su volumen.
# Pide escribir SI. Sin SI no toca nada.
set -u

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source-path=SCRIPTDIR source=../_comun/lib-practicas.sh
. "$AQUI/../_comun/lib-practicas.sh"

VOLUMENES="postgres-datos grafana-2-datos borde-datos mimir-datos"

command -v git >/dev/null 2>&1 || paro "No encuentro git en el PATH."
chequear_docker

echo "${ROJO}${NEGRITA}"
echo "============================================================"
echo "  SE VA A BAJAR LA CAPA DE ESCALA Y SE VAN A BORRAR"
echo "    NGINX, POSTGRESQL, LA SEGUNDA RÉPLICA DE GRAFANA, MIMIR Y EL PROMETHEUS DE BORDE"
echo "    CON SUS VOLÚMENES, INCLUIDO TODO LO QUE SE GUARDÓ EN POSTGRESQL Y EN MIMIR"
echo "    CON LA ORGANIZACIÓN, EL EQUIPO Y LA CARPETA DE LA PRÁCTICA"
echo "    LOS CAMBIOS DE CAPITULO9, CAPITULO9/RESPALDO Y LA CLAVE DE CAPITULO9/SECRETOS"
echo "============================================================"
echo "  EL STACK VUELVE A LEVANTARSE CON GRAFANA SOBRE SQLITE."
echo "  NO HAY VUELTA ATRÁS."
echo "============================================================"
echo "${NORMAL}"

if ! confirmar_si; then
  echo
  ok "No se confirmó. No se tocó nada."
  exit 0
fi

"$RAIZ/bin/caos.sh" apagar >/dev/null 2>&1
"$RAIZ/bin/trafico.sh" nivel normal >/dev/null 2>&1

# Antes de levantar la base, la configuración de Capitulo9 vuelve a git. Así ningún contenedor
# arranca con un archivo a medio editar.
git -C "$RAIZ" checkout -- Capitulo9 2>/dev/null || paro "git no pudo restaurar Capitulo9."
git -C "$RAIZ" clean -fdq -- Capitulo9/prometheus Capitulo9/borde Capitulo9/dashboards \
  || paro "git no pudo borrar los archivos nuevos de Capitulo9."
rm -rf "$AQUI/respaldo" || paro "No pude borrar Capitulo9/respaldo."
rm -f "$AQUI/secretos/postgres" || paro "No pude borrar Capitulo9/secretos/postgres."
ok "Capitulo9 igual a git, sin respaldo y sin la clave de PostgreSQL"

info "Levantando el stack base, sin la capa de escala"
"$RAIZ/bin/up.sh" >/dev/null 2>&1 || paro "bin/up.sh falló. Córrelo a mano para ver el mensaje."
ok "Stack base arriba. La capa quedó fuera porque no está en infra/compose.yaml"

for volumen in $VOLUMENES; do
  if docker volume inspect "gpe_$volumen" >/dev/null 2>&1; then
    docker volume rm "gpe_$volumen" >/dev/null || paro "No pude borrar el volumen gpe_$volumen."
    ok "Volumen gpe_$volumen borrado"
  fi
done

ok "Stack base listo"
