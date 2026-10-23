// Práctica 7. Contenido de los archivos que el alumno escribe, etapa por etapa.
// Lo usan los pasos de captura para escribir cada archivo igual que lo indica la guía. Con
// `node tools/capturas/pasos/7-etapas.mjs ARCHIVO ETAPA` se imprime una etapa, para copiarla a
// la guía.
//
// Etapas  3 node_exporter, 4 Prometheus, 5 Alertmanager, 6 Grafana HTTPS, 7 Dex, 10 secretos.
// La CA llega en dos tiempos en la etapa 3: 'sin-ca' es la predicción del paso, sin ca_file.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const leer = (ruta) => readFileSync(join(RAIZ, ruta), 'utf8');

export const CLAVES = {
  raspar: 'raspar-2026',
  mirar: 'mirar-2026',
  ana: 'ana-2026',
  beto: 'beto-2026',
  oauth: 'secreto-de-grafana-2026',
};

const n = (etapa) => (etapa === 'sin-ca' ? 3 : etapa);

// Bloque de autenticación de un job o de alerting. Antes de la etapa 10 la clave va escrita.
function credenciales(sangria, usuario, secreto, etapa, conCa = true) {
  const s = ' '.repeat(sangria);
  const lineas = [`${s}scheme: https`, `${s}tls_config:`];
  lineas.push(conCa ? `${s}  ca_file: /etc/tls/ca.crt` : `${s}  # Todavía sin ca_file. Ver el paso 18.`);
  lineas.push(`${s}basic_auth:`, `${s}  username: ${usuario}`);
  lineas.push(n(etapa) >= 10 ? `${s}  password_file: /run/secretos/${secreto}` : `${s}  password: ${CLAVES[secreto]}`);
  return lineas.join('\n') + '\n';
}

export function prometheusYml(etapa) {
  const e = n(etapa);
  let s = leer('infra/prometheus/prometheus.yml');
  s = s.replace('# Prometheus del stack gpe.\n',
    '# Prometheus del stack gpe, versión de la Práctica 7 con TLS y autenticación.\n' +
    '# Es una copia de infra/prometheus/prometheus.yml. Cambian alerting y los jobs prometheus,\n' +
    '# node_exporter y alertmanager.\n');
  s = s.replace('  - job_name: node_exporter\n    static_configs:',
    '  - job_name: node_exporter\n' + credenciales(4, 'prometheus', 'raspar', etapa, etapa !== 'sin-ca') + '    static_configs:');
  if (e >= 4) {
    s = s.replace('  - job_name: prometheus\n    static_configs:',
      '  - job_name: prometheus\n' + credenciales(4, 'tianguis', 'mirar', etapa) + '    static_configs:');
  }
  if (e >= 5) {
    s = s.replace('  - job_name: alertmanager\n    static_configs:',
      '  - job_name: alertmanager\n' + credenciales(4, 'tianguis', 'mirar', etapa) + '    static_configs:');
    s = s.replace('  alertmanagers:\n    - static_configs:',
      '  alertmanagers:\n    # Prometheus le habla a Alertmanager por TLS y con clave.\n    - ' +
      credenciales(6, 'tianguis', 'mirar', etapa).trimStart() + '      static_configs:');
  }
  return s;
}

export function datasources(etapa) {
  const clave = n(etapa) >= 10 ? '$__file{/run/secretos/mirar}' : CLAVES.mirar;
  const seguro = `      tlsAuthWithCACert: true\n    secureJsonData:\n      basicAuthPassword: ${clave}\n      tlsCACert: $__file{/etc/tls/ca.crt}\n`;
  let s = leer('infra/grafana/provisioning/datasources/datasources.yaml');
  s = s.replace('# Datasources aprovisionados del stack gpe.\n',
    '# Datasources del stack gpe, versión de la Práctica 7. Prometheus' +
    (n(etapa) >= 5 ? ' y Alertmanager van' : ' va') + ' por TLS y con\n# clave. La CA se lee del archivo montado con $__file.\n');
  s = s.replace('    url: http://prometheus:9090\n    isDefault: true\n',
    '    url: https://prometheus:9090\n    basicAuth: true\n    basicAuthUser: tianguis\n    isDefault: true\n');
  s = s.replace('          urlDisplayLabel: Ver traza\n\n  - name: Loki',
    '          urlDisplayLabel: Ver traza\n' + seguro + '\n  - name: Loki');
  if (n(etapa) >= 5) {
    s = s.replace('    url: http://alertmanager:9093\n    editable: false\n    jsonData:\n      implementation: prometheus\n      handleGrafanaManagedAlerts: false\n',
      '    url: https://alertmanager:9093\n    basicAuth: true\n    basicAuthUser: tianguis\n    editable: false\n    jsonData:\n      implementation: prometheus\n      handleGrafanaManagedAlerts: false\n' + seguro);
  }
  return s;
}

const NODE = `  node-exporter:
    command:
      - --web.config.file=/etc/node-exporter/web.yml
    volumes:
      - ../Capitulo7/trabajo/node-exporter:/etc/node-exporter:ro
      - ../Capitulo7/trabajo/certs:/etc/tls:ro
    healthcheck:
      # Sano si responde por TLS y pide clave. El 401 confirma las dos cosas.
      test: ["CMD", "sh", "-c", "wget -q -O /dev/null --no-check-certificate https://127.0.0.1:9100/ 2>&1 | grep -q 401"]
`;

function prometheus(e) {
  return `  prometheus:
    command:
      - --config.file=/etc/prometheus-seguridad/prometheus.yml
${e >= 4 ? '      - --web.config.file=/etc/prometheus-seguridad/web.yml\n' : ''}      - --storage.tsdb.path=/prometheus
      - --web.enable-otlp-receiver
      - --enable-feature=exemplar-storage
    volumes:
      - ../Capitulo7/trabajo/prometheus:/etc/prometheus-seguridad:ro
      - ../Capitulo7/trabajo/certs:/etc/tls:ro
${e >= 10 ? '      - ../Capitulo7/trabajo/secretos:/run/secretos:ro\n' : ''}${e >= 4 ? `    healthcheck:
      test: ["CMD", "sh", "-c", "wget -q -O /dev/null --no-check-certificate https://127.0.0.1:9090/-/ready 2>&1 | grep -q 401"]
` : ''}`;
}

const ALERTMANAGER = `  alertmanager:
    command:
      - --config.file=/etc/alertmanager/alertmanager.yml
      - --web.config.file=/etc/alertmanager-seguridad/web.yml
      - --storage.path=/alertmanager
      - --web.external-url=https://localhost:\${PUERTO_ALERTMANAGER}
    volumes:
      - ../Capitulo7/trabajo/alertmanager:/etc/alertmanager-seguridad:ro
      - ../Capitulo7/trabajo/certs:/etc/tls:ro
    healthcheck:
      test: ["CMD", "sh", "-c", "wget -q -O /dev/null --no-check-certificate https://127.0.0.1:9093/-/ready 2>&1 | grep -q 401"]
`;

function grafana(e) {
  let entorno = '';
  if (e >= 6) {
    entorno += `      # HTTPS con el certificado de la CA del curso.
      GF_SERVER_PROTOCOL: https
      GF_SERVER_CERT_FILE: /etc/tls/grafana.crt
      GF_SERVER_CERT_KEY: /etc/tls/grafana.key
      GF_SERVER_ROOT_URL: https://localhost:\${PUERTO_GRAFANA}/
`;
  }
  if (e >= 10) {
    entorno += `      # La clave de admin sale de un archivo. Solo cuenta la primera vez que arranca Grafana.
      # La variable sin __FILE viene del compose base y Grafana no acepta las dos: aquí se vacía.
      GF_SECURITY_ADMIN_PASSWORD: ""
      GF_SECURITY_ADMIN_PASSWORD__FILE: /run/secretos/grafana_admin
`;
  }
  if (e >= 7) {
    entorno += `      # Login con Dex. El navegador va a localhost:5556 y Grafana pide el token por la red interna.
      GF_AUTH_GENERIC_OAUTH_ENABLED: "true"
      GF_AUTH_GENERIC_OAUTH_NAME: Dex
      GF_AUTH_GENERIC_OAUTH_CLIENT_ID: grafana
${e >= 10 ? '      GF_AUTH_GENERIC_OAUTH_CLIENT_SECRET__FILE: /run/secretos/oauth_grafana\n' : `      GF_AUTH_GENERIC_OAUTH_CLIENT_SECRET: ${CLAVES.oauth}\n`}      GF_AUTH_GENERIC_OAUTH_SCOPES: openid profile email
      GF_AUTH_GENERIC_OAUTH_AUTH_URL: http://localhost:5556/dex/auth
      GF_AUTH_GENERIC_OAUTH_TOKEN_URL: http://dex:5556/dex/token
      GF_AUTH_GENERIC_OAUTH_API_URL: http://dex:5556/dex/userinfo
      GF_AUTH_GENERIC_OAUTH_ALLOW_SIGN_UP: "true"
      # Ana entra como Editor. Cualquier otro usuario de Dex entra como Viewer.
      GF_AUTH_GENERIC_OAUTH_ROLE_ATTRIBUTE_PATH: "email == 'ana@tianguis.local' && 'Editor' || 'Viewer'"
`;
  }
  return `  grafana:
${entorno ? `    environment:\n${entorno}` : ''}    volumes:
      - ../Capitulo7/trabajo/certs:/etc/tls:ro
${e >= 10 ? '      - ../Capitulo7/trabajo/secretos:/run/secretos:ro\n' : ''}      - ../Capitulo7/trabajo/grafana/datasources:/etc/grafana/provisioning/datasources:ro
${e >= 6 ? `    healthcheck:
      test: ["CMD", "wget", "-q", "-O", "/dev/null", "--no-check-certificate", "https://127.0.0.1:3000/api/health"]
` : ''}`;
}

const DEX = `  dex:
    container_name: gpe-dex
    image: dexidp/dex:v2.45.1
    command: ["dex", "serve", "/etc/dex/config.yaml"]
    restart: unless-stopped
    volumes:
      - ../Capitulo7/trabajo/dex:/etc/dex:ro
    ports:
      - "127.0.0.1:5556:5556"
    healthcheck:
      test: ["CMD", "wget", "-q", "-O", "/dev/null", "http://127.0.0.1:5558/healthz"]
      interval: 10s
      timeout: 5s
      retries: 6
      start_period: 10s
    mem_limit: 64m
`;

export const CABECERA = `# Capa de seguridad de la Práctica 7. Se suma al compose del stack con un segundo -f.
#
#   docker compose -p gpe --env-file infra/.env -f infra/compose.yaml \\
#     -f Capitulo7/compose.seguridad.yaml up -d
#
# Las rutas son relativas a infra/, la carpeta del primer archivo, por eso empiezan con ../
# Lo que se escribe aquí reemplaza o se agrega a lo de infra/compose.yaml. Lo demás queda igual.
`;

export function compose(etapa) {
  const e = n(etapa);
  const partes = [NODE, prometheus(e)];
  if (e >= 5) partes.push(ALERTMANAGER);
  if (e >= 4) partes.push(grafana(e));
  if (e >= 7) partes.push(DEX);
  const nota = e >= 10 ? '# Ninguna clave va escrita en este archivo: se leen de Capitulo7/trabajo/secretos.\n' : '';
  return `${CABECERA}${nota}\nservices:\n${partes.join('\n')}`;
}

// Bloque de un servicio del compose en una etapa, para la guía.
export function bloque(servicio, etapa) {
  const e = n(etapa);
  return { 'node-exporter': NODE, prometheus: prometheus(e), alertmanager: ALERTMANAGER, grafana: grafana(e), dex: DEX }[servicio];
}

const ARCHIVOS = { compose, prometheusYml, datasources, bloque };

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const [archivo, etapa, servicio] = process.argv.slice(2);
  const e = etapa === 'sin-ca' ? etapa : Number(etapa);
  process.stdout.write(archivo === 'bloque' ? ARCHIVOS.bloque(servicio, e) : ARCHIVOS[archivo](e));
}
