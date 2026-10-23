#!/usr/bin/env bash
# Genera las capturas de una práctica.
#
#   tools/capturas/capturar.sh N     escribe images/N/1.png, 2.png ...
#
# Recorre la práctica completa en el stack real, así que deja el stack como lo deja un alumno
# que la terminó. Necesita Node 22 o superior y el stack arriba.
set -u

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ $# -ne 1 ]; then
  echo "Uso: tools/capturas/capturar.sh N    (N es el número de la práctica)" >&2
  exit 2
fi
command -v node >/dev/null 2>&1 || { echo "No encuentro node en el PATH. Instala Node 22 o superior." >&2; exit 1; }

cd "$AQUI" || exit 1
if [ ! -d node_modules ]; then
  echo "==> Instalando Playwright con la versión fijada en package-lock.json"
  npm ci || exit 1
  npx playwright install chromium || exit 1
fi

node capturar.mjs "$1"
