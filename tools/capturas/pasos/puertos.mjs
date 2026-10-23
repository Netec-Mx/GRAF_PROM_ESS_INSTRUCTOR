// Puertos de Grafana y Prometheus en el host, leídos de infra/.env. Los pasos de captura los usan
// en los comandos que corren, así funcionan en cualquier máquina. Las guías citan siempre los
// puertos por defecto, 3000 y 9090.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function leerEnv(nombre) {
  const linea = readFileSync(join(RAIZ, 'infra', '.env'), 'utf8')
    .split(/\r?\n/).filter((l) => l.startsWith(`${nombre}=`)).pop();
  if (linea === undefined) throw new Error(`Falta ${nombre} en infra/.env`);
  return linea.slice(nombre.length + 1);
}

export const GRAFANA = leerEnv('PUERTO_GRAFANA');
export const PROMETHEUS = leerEnv('PUERTO_PROMETHEUS');
