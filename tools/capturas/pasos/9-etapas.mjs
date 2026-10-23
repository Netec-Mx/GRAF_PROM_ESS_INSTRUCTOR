// Práctica 9. Cómo queda Capitulo9/prometheus/prometheus.yml después de cada paso.
// La guía muestra estos mismos bloques y las capturas escriben el archivo con ellos, así no
// pueden diferir. La última etapa tiene que ser igual a Capitulo9/solucion/prometheus/prometheus.yml.
//
//   node tools/capturas/pasos/9-etapas.mjs 5    escribe el archivo como queda después del paso 5
//   node tools/capturas/pasos/9-etapas.mjs 8a   el paso 8 con un cupo chico, todavía sin el descarte

import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const ARCHIVO = 'Capitulo9/prometheus/prometheus.yml';

// El archivo como está en git, que es el punto de partida del alumno.
const base = () => execFileSync('git', ['show', `HEAD:${ARCHIVO}`], { cwd: RAIZ, encoding: 'utf8' });

export const bloques = {
  // Descubrimiento. Los destinos dev salen de archivos.
  catalogoAntes: `      - targets: ["catalogo-dev:8000"]
        labels:
          ambiente: dev
`,
  catalogoDespues: `    # Descubrimiento. El ambiente dev sale de un archivo. Prometheus lo vuelve a leer cuando cambia.
    file_sd_configs:
      - files: ["/etc/prometheus-escala/destinos/catalogo.yml"]
        refresh_interval: 30s
`,
  pedidosAntes: `      - targets: ["pedidos-dev:8080"]
        labels:
          ambiente: dev
`,
  pedidosDespues: `    file_sd_configs:
      - files: ["/etc/prometheus-escala/destinos/pedidos.yml"]
        refresh_interval: 30s
`,
  http: `
  # Descubrimiento HTTP. nginx sirve la lista de destinos como un archivo JSON.
  - job_name: descubierto-por-http
    http_sd_configs:
      - url: http://nginx/sd/destinos.json
        refresh_interval: 30s
`,
  // Escritura remota.
  remota: `# Escritura remota. Copia de todo lo que se raspa hacia Mimir, el archivo nacional.
remote_write:
  - name: mimir
    url: http://mimir:9009/api/v1/push

`,
  // Cupos, descarte y retención.
  lokiAntes: `  - job_name: loki
    static_configs:
      - targets: ["loki:3100"]
`,
  // Primero un cupo chico, para ver qué pasa cuando se supera.
  cuposChicos: `  - job_name: loki
    # Cupos. Si un raspado trae más de 1000 muestras o una serie con más de 30
    # etiquetas, Prometheus descarta el raspado completo y el destino queda abajo.
    sample_limit: 1000
    label_limit: 30
    static_configs:
      - targets: ["loki:3100"]
`,
  // Después un cupo con margen, el que queda.
  cupos: `  - job_name: loki
    # Cupos. Si un raspado trae más de 5000 muestras o una serie con más de 30
    # etiquetas, Prometheus descarta el raspado completo y el destino queda abajo.
    sample_limit: 5000
    label_limit: 30
    static_configs:
      - targets: ["loki:3100"]
`,
  descarte: `    # Descarta los histogramas del tamaño de los mensajes de Loki. Son cientos de series que
    # nadie mira.
    metric_relabel_configs:
      - source_labels: [__name__]
        regex: loki_(request|response)_message_bytes_.*
        action: drop
`,
  retencionAntes: `      time: 7d
`,
  retencion: `      # Retención por tamaño además de por tiempo. Se borra el bloque más viejo cuando se
      # cumple cualquiera de los dos.
      size: 2GB
`,
};

function reemplazar(texto, antes, despues) {
  if (!texto.includes(antes)) throw new Error(`No encuentro en ${ARCHIVO}:\n${antes}`);
  return texto.replace(antes, despues);
}

export function etapa(nombre) {
  let texto = base();
  const orden = ['5', '7', '8a', '8'];
  const hasta = orden.indexOf(nombre);
  if (hasta < 0) throw new Error(`Etapa desconocida ${nombre}. Son ${orden.join(', ')}.`);
  const b = bloques;
  texto = reemplazar(texto, b.catalogoAntes, b.catalogoDespues);
  texto = reemplazar(texto, b.pedidosAntes, b.pedidosDespues);
  texto += b.http;
  if (hasta >= 1) texto = reemplazar(texto, 'rule_files:', `${b.remota}rule_files:`);
  if (hasta === 2) texto = reemplazar(texto, b.lokiAntes, b.cuposChicos);
  if (hasta >= 3) {
    texto = reemplazar(texto, b.lokiAntes, b.cupos + b.descarte);
    texto = reemplazar(texto, b.retencionAntes, b.retencionAntes + b.retencion);
  }
  return texto;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const nombre = process.argv[2];
  const texto = etapa(nombre);
  if (nombre === '8') {
    const solucion = readFileSync(join(RAIZ, 'Capitulo9/solucion/prometheus/prometheus.yml'), 'utf8');
    if (texto !== solucion) throw new Error('La etapa 8 no es igual a Capitulo9/solucion/prometheus/prometheus.yml');
  }
  writeFileSync(join(RAIZ, ARCHIVO), texto);
}
