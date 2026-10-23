#!/usr/bin/env bash
# Práctica 7, solución. Arma Capitulo7/trabajo/ resuelto: copia las configuraciones de la
# solución, genera la CA, los certificados y sus claves privadas, escribe los secretos y calcula
# los hashes bcrypt. También deja Capitulo7/compose.seguridad.yaml resuelto.
#
# Las claves privadas no están en el repositorio: este script las genera cada vez.
# Pide escribir SI si Capitulo7/trabajo/ ya existe, porque lo reemplaza.
set -u

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source-path=SCRIPTDIR source=../../_comun/lib-practicas.sh
. "$AQUI/../../_comun/lib-practicas.sh"

CAPITULO="$RAIZ/Capitulo7"
TRABAJO="$CAPITULO/trabajo"
CERTS="$TRABAJO/certs"
IMAGEN_HTPASSWD="httpd:2.4.68-alpine"

# Claves del laboratorio. Son las mismas que usa la guía.
CLAVE_RASPAR="raspar-2026"
CLAVE_MIRAR="mirar-2026"
CLAVE_ANA="ana-2026"
CLAVE_BETO="beto-2026"
SECRETO_OAUTH="secreto-de-grafana-2026"

command -v openssl >/dev/null 2>&1 || paro "No encuentro openssl. En Windows viene con Git Bash."
chequear_docker

if [ -d "$TRABAJO" ]; then
  echo "${ROJO}${NEGRITA}SE VA A REEMPLAZAR CAPITULO7/TRABAJO/ CON LA SOLUCIÓN. SE PIERDE LO QUE HICISTE AHÍ.${NORMAL}"
  confirmar_si || { ok "No se confirmó. No se tocó nada."; exit 0; }
  rm -rf "$TRABAJO"
fi

mkdir -p "$TRABAJO"
cp -R "$AQUI/trabajo/." "$TRABAJO/"
# La plantilla de Dex está fuera de solucion/ porque el alumno también la copia.
mkdir -p "$TRABAJO/dex"
cp "$CAPITULO/dex/config.yaml" "$TRABAJO/dex/config.yaml"
cp "$AQUI/compose.seguridad.yaml" "$CAPITULO/compose.seguridad.yaml"
ok "Configuraciones de la solución copiadas"

# --- CA y certificados ------------------------------------------------------------------------
mkdir -p "$CERTS"
# openssl corre dentro de la carpeta y con nombres relativos. En Git Bash, MSYS_NO_PATHCONV=1
# evita que /CN=... se convierta en ruta, pero también deja sin convertir una ruta como
# /c/gpe/..., que openssl de Windows no sabe abrir.
cd "$CERTS" || paro "No pude entrar a Capitulo7/trabajo/certs."
MSYS_NO_PATHCONV=1 openssl req -x509 -newkey rsa:2048 -nodes -days 365 \
  -keyout ca.key -out ca.crt -subj "/CN=CA del Tianguis" 2>/dev/null \
  || paro "openssl no pudo crear la CA."
for s in prometheus node-exporter alertmanager grafana; do
  MSYS_NO_PATHCONV=1 openssl req -newkey rsa:2048 -nodes \
    -keyout "$s.key" -out "$s.csr" -subj "/CN=$s" 2>/dev/null \
    || paro "openssl no pudo crear la clave de $s."
  printf 'subjectAltName=DNS:%s,DNS:localhost,IP:127.0.0.1\n' "$s" > "$s.ext"
  openssl x509 -req -in "$s.csr" -CA ca.crt -CAkey ca.key \
    -CAcreateserial -days 365 -extfile "$s.ext" -out "$s.crt" 2>/dev/null \
    || paro "openssl no pudo firmar el certificado de $s."
done
cd "$RAIZ" || paro "No pude volver a la raíz del repo."
# Los contenedores corren con otro usuario y tienen que poder leer las claves.
chmod 644 "$CERTS"/*.key
ok "CA y certificados de prometheus, node-exporter, alertmanager y grafana"

# --- Secretos --------------------------------------------------------------------------------
mkdir -p "$TRABAJO/secretos"
printf '%s' "$CLAVE_RASPAR" > "$TRABAJO/secretos/raspar"
printf '%s' "$CLAVE_MIRAR" > "$TRABAJO/secretos/mirar"
printf '%s' "$SECRETO_OAUTH" > "$TRABAJO/secretos/oauth_grafana"
printf '%s' "$(leer_env GRAFANA_ADMIN_PASSWORD)" > "$TRABAJO/secretos/grafana_admin"
chmod 644 "$TRABAJO/secretos"/*
ok "Secretos en Capitulo7/trabajo/secretos"

# --- Hashes bcrypt ---------------------------------------------------------------------------
# hash USUARIO CLAVE  ->  hash bcrypt, calculado con htpasswd dentro de un contenedor.
hash() {
  docker run --rm "$IMAGEN_HTPASSWD" htpasswd -nbBC 10 "$1" "$2" | tr -d '\r' | head -n 1 | cut -d: -f2-
}
reemplazar() {
  local archivo="$1" marca="$2" valor="$3" temporal
  temporal="$(mktemp)"
  awk -v m="$marca" -v v="$valor" '{ gsub(m, v); print }' "$archivo" > "$temporal" && mv "$temporal" "$archivo"
}
h_raspar="$(hash prometheus "$CLAVE_RASPAR")"
h_mirar="$(hash tianguis "$CLAVE_MIRAR")"
h_ana="$(hash ana "$CLAVE_ANA")"
h_beto="$(hash beto "$CLAVE_BETO")"
[ -n "$h_raspar" ] && [ -n "$h_mirar" ] || paro "No pude calcular los hashes con $IMAGEN_HTPASSWD."
reemplazar "$TRABAJO/node-exporter/web.yml" HASH_RASPAR "$h_raspar"
reemplazar "$TRABAJO/prometheus/web.yml" HASH_MIRAR "$h_mirar"
reemplazar "$TRABAJO/alertmanager/web.yml" HASH_MIRAR "$h_mirar"
reemplazar "$TRABAJO/dex/config.yaml" HASH_ANA "$h_ana"
reemplazar "$TRABAJO/dex/config.yaml" HASH_BETO "$h_beto"
reemplazar "$TRABAJO/dex/config.yaml" SECRETO_OAUTH "$SECRETO_OAUTH"
reemplazar "$TRABAJO/dex/config.yaml" PUERTO_GRAFANA "$(leer_env PUERTO_GRAFANA)"
ok "Hashes bcrypt en los web config y en Dex, y el puerto de Grafana en Dex"

echo
ok "Capitulo7/trabajo/ quedó resuelto. Para aplicar la capa de seguridad"
echo "    docker compose -p gpe --env-file infra/.env -f infra/compose.yaml -f Capitulo7/compose.seguridad.yaml up -d"
