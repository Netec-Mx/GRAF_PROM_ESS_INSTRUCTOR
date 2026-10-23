#!/usr/bin/env bash
# Corre una conciliación a mano, ahora, y muestra su resultado y su código de salida.
# Le manda SIGUSR1 al planificador de gpe-conciliacion, que lanza una corrida en el momento.
# Como la corrida sale del mismo contenedor, sus logs también llegan a Loki.
set -u

. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

CONTENEDOR="gpe-conciliacion"
ESPERA_MAX=60   # segundos

chequear_docker
asegurar_env

if [ "$(docker inspect --format '{{.State.Status}}' "$CONTENEDOR" 2>/dev/null)" != "running" ]; then
  paro "$CONTENEDOR no está corriendo. Levanta el stack con bin/up.sh."
fi

# Hora del contenedor, para leer solo el log que se escriba de aquí en adelante.
desde="$(docker exec "$CONTENEDOR" date -u +%Y-%m-%dT%H:%M:%SZ)"

# Las líneas del log que corresponden a este pedido.
# Lo normal: desde que el planificador anota "corrida manual solicitada".
# Si había una corrida en curso, el planificador anota "corrida manual ignorada" recién cuando
# esa corrida termina; en ese caso sirve todo el log desde que se mandó la señal.
log_de_esta_corrida() {
  local todo
  todo="$(docker logs --since "$desde" "$CONTENEDOR" 2>&1)"
  if printf '%s\n' "$todo" | grep -q '"msg": "corrida manual ignorada'; then
    printf '%s\n' "$todo"
  else
    printf '%s\n' "$todo" | sed -n '/"msg": "corrida manual solicitada"/,$p'
  fi
}

info "Pidiendo una conciliación a $CONTENEDOR"
# kill es una orden interna del shell: la imagen no trae un programa kill aparte.
docker exec "$CONTENEDOR" sh -c 'kill -USR1 1' || paro "No pude mandarle la señal a $CONTENEDOR."

inicio=$(date +%s)
while :; do
  lineas="$(log_de_esta_corrida)"
  # Una corrida termina con una de estas dos líneas.
  fin="$(printf '%s\n' "$lineas" | grep -E '"msg": "conciliacion (terminada|fallida)"' | tail -n 1)"
  [ -n "$fin" ] && break
  if [ $(( $(date +%s) - inicio )) -ge "$ESPERA_MAX" ]; then
    printf '%s\n' "$lineas"
    paro "Pasaron ${ESPERA_MAX}s y la corrida no terminó. Revisa: docker logs $CONTENEDOR"
  fi
  sleep 1
done

printf '%s\n' "$lineas"
echo

if printf '%s\n' "$lineas" | grep -q '"msg": "corrida manual ignorada'; then
  aviso "Ya había una corrida en curso. El resultado de arriba es el de esa corrida."
fi

if printf '%s\n' "$fin" | grep -q '"result": "success"'; then
  ok "Corrida exitosa (código de salida 0)"
  codigo=0
else
  error "Corrida fallida (código de salida 1)"
  codigo=1
fi
echo "    Sus métricas quedan en el Pushgateway: http://localhost:$(leer_env PUERTO_PUSHGATEWAY)"
exit "$codigo"
