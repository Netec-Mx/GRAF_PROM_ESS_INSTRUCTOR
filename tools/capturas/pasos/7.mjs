// Práctica 7. Red segura y certificados TLS para Prometheus y Grafana.
// Cada paso: tipo, sitio y url (o comando), espera, acción, recorte y número de imagen.
// Los pasos sin imagen hacen lo que el alumno hace a mano entre una captura y la siguiente.
// Lo que el alumno escribe en un editor sale de 7-etapas.mjs, igual que en la guía.

import { GRAFANA, PROMETHEUS } from './puertos.mjs';

const LIB = '. _comun/lib-practicas.sh';
const ETAPAS = 'node tools/capturas/pasos/7-etapas.mjs';
const T = 'Capitulo7/trabajo';
const CA = `${T}/certs/ca.crt`;
const HTPASSWD = 'docker run --rm httpd:2.4.68-alpine htpasswd -nbBC 10';
const CAPA = 'docker compose -p gpe --env-file infra/.env -f infra/compose.yaml -f Capitulo7/compose.seguridad.yaml up -d';

const alto = (h) => ({ x: 0, y: 0, width: 1440, height: h });
const sinPuntero = (page) => page.mouse.move(720, 890);
const texto = (t) => async (page) => { await page.getByText(t).filter({ visible: true }).first().waitFor(); };
const web = (sitio, url, espera, imagen, recorte, accion) => ({ tipo: 'web', sitio, url, espera, accion, imagen, recorte });

// Espera con tope a que una condición de bash se cumpla.
const hasta = (condicion, tope = 300) =>
  `${LIB}; n=0; until ${condicion}; do n=$((n + 3)); [ "$n" -lt ${tope} ] || exit 1; sleep 3; done`;
const sanos = { tipo: 'terminal', nota: 'todo healthy', comando: hasta('bin/estado.sh >/dev/null 2>&1', 300) };

// Escribe un archivo de una etapa, como lo deja el alumno en su editor.
const escribir = (nota, archivo, destino, etapa) =>
  ({ tipo: 'terminal', nota, comando: `${ETAPAS} ${archivo} ${etapa} > ${destino}` });

// Escribe un web config con el hash bcrypt de un usuario, como lo arma el alumno.
function webConfig(destino, servicio, usuario, clave, comentario) {
  return {
    tipo: 'terminal',
    nota: `el alumno escribe ${destino}`,
    comando: `h="$(${HTPASSWD} ${usuario} ${clave} | tr -d '\\r' | head -n 1 | cut -d: -f2-)"
      mkdir -p "$(dirname ${destino})"
      printf '%s\\n' '# ${comentario}' 'tls_server_config:' '  cert_file: /etc/tls/${servicio}.crt' '  key_file: /etc/tls/${servicio}.key' 'basic_auth_users:' "  ${usuario}: $h" > ${destino}`,
  };
}

// Variable de los destinos de Prometheus: espera a que un job tenga cierto estado.
const destino = (job, estado, https = false) =>
  `curl -s ${https ? `--cacert ${CA} -u tianguis:mirar-2026 https` : 'http'}://localhost:${PROMETHEUS}/api/v1/targets | tr -d '\\n' | grep -o '"job":"${job}"[^}]*}[^}]*"health":"[a-z]*"' | grep -q '"health":"${estado}"'`;


// --- Grafana con otros usuarios ------------------------------------------------------------

async function entrarComo(page, ayudas, usuario, clave) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await ayudas.cerrarSesiones(page);
  // Si la página todavía estaba navegando, el primer goto se aborta. Se reintenta una vez.
  await page.goto(ayudas.urlDe('grafanaTls', '/login')).catch(() => page.goto(ayudas.urlDe('grafanaTls', '/login')));
  await page.fill('input[name="user"]', usuario);
  await page.fill('input[name="password"]', clave);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  ayudas.marcarSesion('grafanaTls');
}

// Vuelve a la sesión de admin en el paso siguiente.
const comoAdmin = (page, ayudas) => ayudas.cerrarSesiones(page);

async function nuevoUsuario(page, nombre, login, clave) {
  await page.getByLabel('Name', { exact: false }).first().fill(nombre);
  await page.locator('input[name="email"]').fill(`${login}@tianguis.local`);
  await page.locator('input[name="login"]').fill(login);
  await page.locator('input[name="password"]').fill(clave);
}

export default [
  // --- Dejar todo como antes de empezar la práctica -------------------------------------
  { tipo: 'terminal', nota: 'bajar la capa de una corrida anterior', comando: 'Capitulo7/restaurar.sh', entrada: 'SI\n' },

  // --- Punto de partida -----------------------------------------------------------------
  { tipo: 'terminal', comando: 'Capitulo7/preparar.sh', imagen: 1 },

  // --- Paso 1. Superficie de exposición -------------------------------------------------
  { tipo: 'terminal', comando: "docker ps --filter label=com.docker.compose.project=gpe --format 'table {{.Names}}\\t{{.Ports}}'", imagen: 2 },
  web('prometheus', '/config', texto('scrape_configs'), 3, alto(620)),
  web('prometheus', '/targets', texto('node_exporter'), 4, alto(620)),
  { tipo: 'terminal', comando: "curl -s http://localhost:9100/metrics | grep -m 8 '^node_uname_info\\|^node_os_info\\|^node_filesystem_size_bytes'", imagen: 5 },

  // --- Paso 2. CA propia y certificados -------------------------------------------------
  {
    tipo: 'terminal',
    comando: `mkdir -p ${T}/certs
MSYS_NO_PATHCONV=1 openssl req -x509 -newkey rsa:2048 -nodes -days 365 -keyout ${T}/certs/ca.key -out ${T}/certs/ca.crt -subj "/CN=CA del Tianguis"
openssl x509 -in ${T}/certs/ca.crt -noout -subject -issuer -dates`,
    contiene: 'CA del Tianguis',
    imagen: 6,
  },
  {
    tipo: 'terminal',
    comando: `for s in prometheus node-exporter alertmanager grafana; do
  MSYS_NO_PATHCONV=1 openssl req -newkey rsa:2048 -nodes -keyout ${T}/certs/$s.key -out ${T}/certs/$s.csr -subj "/CN=$s"
  printf 'subjectAltName=DNS:%s,DNS:localhost,IP:127.0.0.1\\n' $s > ${T}/certs/$s.ext
  openssl x509 -req -in ${T}/certs/$s.csr -CA ${T}/certs/ca.crt -CAkey ${T}/certs/ca.key -CAcreateserial -days 365 -extfile ${T}/certs/$s.ext -out ${T}/certs/$s.crt
done
chmod 644 ${T}/certs/*.key
ls ${T}/certs`,
    contiene: 'grafana.crt',
    imagen: 7,
    ultimas: 24,
  },
  {
    tipo: 'terminal',
    comando: `openssl verify -CAfile ${T}/certs/ca.crt ${T}/certs/prometheus.crt
openssl x509 -in ${T}/certs/prometheus.crt -noout -text | grep -A1 'Subject Alternative Name'`,
    contiene: 'OK',
    imagen: 8,
  },

  // --- Paso 3. node_exporter con TLS y autenticación ------------------------------------
  { tipo: 'terminal', comando: `${HTPASSWD} prometheus raspar-2026`, contiene: 'prometheus:$2y$', imagen: 9 },
  webConfig(`${T}/node-exporter/web.yml`, 'node-exporter', 'prometheus', 'raspar-2026', 'node_exporter con TLS y autenticación básica.'),
  { tipo: 'terminal', nota: 'carpeta de la configuración de Prometheus', comando: `mkdir -p ${T}/prometheus` },
  escribir('el alumno copia y edita prometheus.yml, sin la CA todavía', 'prometheusYml', `${T}/prometheus/prometheus.yml`, 'sin-ca'),
  escribir('el alumno escribe compose.seguridad.yaml, etapa 3', 'compose', 'Capitulo7/compose.seguridad.yaml', 3),
  { tipo: 'terminal', comando: CAPA, imagen: 10, ultimas: 8 },
  sanos,
  { tipo: 'terminal', nota: 'node_exporter sin la CA queda abajo', comando: hasta(destino('node_exporter', 'down'), 120) },
  web('prometheus', '/targets?search=node', texto('x509'), 11, alto(560)),
  escribir('el alumno agrega ca_file', 'prometheusYml', `${T}/prometheus/prometheus.yml`, 3),
  { tipo: 'terminal', comando: 'docker exec gpe-prometheus kill -HUP 1' },
  { tipo: 'terminal', nota: 'node_exporter sube', comando: hasta(destino('node_exporter', 'up'), 120) },
  web('prometheus', '/targets?search=node', texto('https://node-exporter:9100/metrics'), 12, alto(420)),
  {
    tipo: 'terminal',
    comando: `curl -s -o /dev/null -w '%{http_code}\\n' --cacert ${CA} https://localhost:9100/metrics
curl -s -o /dev/null -w '%{http_code}\\n' --cacert ${CA} -u prometheus:raspar-2026 https://localhost:9100/metrics`,
    contiene: '401',
    imagen: 13,
  },

  // --- Paso 4. Prometheus con TLS y autenticación ---------------------------------------
  { tipo: 'terminal', comando: `${HTPASSWD} tianguis mirar-2026`, contiene: 'tianguis:$2y$', imagen: 14 },
  webConfig(`${T}/prometheus/web.yml`, 'prometheus', 'tianguis', 'mirar-2026', 'La interfaz y la API de Prometheus, con TLS y autenticación básica.'),
  escribir('el alumno protege el job prometheus', 'prometheusYml', `${T}/prometheus/prometheus.yml`, 4),
  { tipo: 'terminal', nota: 'carpeta de los datasources', comando: `mkdir -p ${T}/grafana/datasources` },
  escribir('el alumno copia y edita los datasources', 'datasources', `${T}/grafana/datasources/datasources.yaml`, 4),
  escribir('el alumno escribe compose.seguridad.yaml, etapa 4', 'compose', 'Capitulo7/compose.seguridad.yaml', 4),
  { tipo: 'terminal', nota: 'aplicar la capa', comando: CAPA },
  sanos,
  {
    tipo: 'terminal',
    comando: `curl -s -o /dev/null -w '%{http_code}\\n' --cacert ${CA} https://localhost:${PROMETHEUS}/api/v1/status/config
curl -s -o /dev/null -w '%{http_code}\\n' --cacert ${CA} -u tianguis:mirar-2026 https://localhost:${PROMETHEUS}/api/v1/status/config`,
    contiene: '200',
    imagen: 15,
  },
  { tipo: 'terminal', nota: 'los tres jobs por https', comando: hasta(destino('prometheus', 'up', true), 120) },
  web('prometheusTls', '/targets', texto('https://prometheus:9090/metrics'), 16, 'pagina'),
  web('grafana', `/explore?schemaVersion=1&orgId=1&panes=${encodeURIComponent(JSON.stringify({ a: { datasource: 'prometheus', queries: [{ refId: 'A', expr: 'up{job=~"prometheus|node_exporter"}', range: false, instant: true, datasource: { type: 'prometheus', uid: 'prometheus' } }], range: { from: 'now-15m', to: 'now' } } }))}`,
    async (page) => { await page.getByText('node_exporter').first().waitFor(); }, 17, alto(620)),

  // --- Paso 5. Alertmanager con TLS y autenticación -------------------------------------
  webConfig(`${T}/alertmanager/web.yml`, 'alertmanager', 'tianguis', 'mirar-2026', 'La interfaz y la API de Alertmanager, con TLS y autenticación básica.'),
  escribir('el alumno protege alerting y el job alertmanager', 'prometheusYml', `${T}/prometheus/prometheus.yml`, 5),
  escribir('el alumno agrega Alertmanager a los datasources', 'datasources', `${T}/grafana/datasources/datasources.yaml`, 5),
  escribir('el alumno escribe compose.seguridad.yaml, etapa 5', 'compose', 'Capitulo7/compose.seguridad.yaml', 5),
  { tipo: 'terminal', nota: 'aplicar la capa', comando: CAPA },
  sanos,
  { tipo: 'terminal', comando: 'docker exec gpe-prometheus kill -HUP 1' },
  { tipo: 'terminal', nota: 'Prometheus encuentra a Alertmanager por https', comando: hasta(`curl -s --cacert ${CA} -u tianguis:mirar-2026 https://localhost:${PROMETHEUS}/api/v1/alertmanagers | grep -q 'https://alertmanager'`, 120) },
  {
    tipo: 'terminal',
    comando: `curl -s -o /dev/null -w '%{http_code}\\n' --cacert ${CA} https://localhost:9093/api/v2/status
curl -s --cacert ${CA} -u tianguis:mirar-2026 https://localhost:${PROMETHEUS}/api/v1/alertmanagers`,
    contiene: 'https://alertmanager:9093',
    imagen: 18,
  },

  // --- Paso 6. Grafana en HTTPS ---------------------------------------------------------
  escribir('el alumno escribe compose.seguridad.yaml, etapa 6', 'compose', 'Capitulo7/compose.seguridad.yaml', 6),
  { tipo: 'terminal', nota: 'aplicar la capa', comando: CAPA },
  sanos,
  {
    tipo: 'terminal',
    comando: `openssl s_client -connect localhost:${GRAFANA} -servername localhost -CAfile ${CA} </dev/null 2>/dev/null | grep -E 'subject=|issuer=|Verify return code'`,
    contiene: 'Verify return code: 0',
    imagen: 19,
  },
  { tipo: 'terminal', comando: `curl -s --cacert ${CA} https://localhost:${GRAFANA}/api/health`, contiene: 'database', imagen: 20 },

  // --- Paso 7. Login con Dex ------------------------------------------------------------
  { tipo: 'terminal', comando: `${HTPASSWD} ana ana-2026`, contiene: 'ana:$2y$', imagen: 21 },
  {
    tipo: 'terminal',
    nota: 'el alumno escribe la configuración de Dex',
    comando: `mkdir -p ${T}/dex
      a="$(${HTPASSWD} ana ana-2026 | tr -d '\\r' | head -n 1 | cut -d: -f2-)"
      b="$(${HTPASSWD} beto beto-2026 | tr -d '\\r' | head -n 1 | cut -d: -f2-)"
      awk -v a="$a" -v b="$b" '{ gsub("HASH_ANA", a); gsub("HASH_BETO", b); gsub("SECRETO_OAUTH", "secreto-de-grafana-2026"); gsub("PUERTO_GRAFANA", "${GRAFANA}"); print }' Capitulo7/dex/config.yaml > ${T}/dex/config.yaml`,
  },
  escribir('el alumno escribe compose.seguridad.yaml, etapa 7', 'compose', 'Capitulo7/compose.seguridad.yaml', 7),
  { tipo: 'terminal', nota: 'aplicar la capa', comando: CAPA },
  sanos,
  { tipo: 'terminal', nota: 'Dex healthy', comando: hasta('[ "$(contenedor_salud gpe-dex)" = "healthy" ]', 120) },
  {
    tipo: 'web',
    sitio: 'grafanaTls',
    nota: 'pantalla de login con Dex',
    accion: async (page, ayudas) => {
      await ayudas.cerrarSesiones(page);
      await page.goto(ayudas.urlDe('grafanaTls', '/login'));
      await page.getByText(/Sign in with Dex/).waitFor();
      ayudas.marcarSesion('grafanaTls');
    },
    imagen: 22,
  },
  {
    tipo: 'web',
    sitio: 'grafanaTls',
    nota: 'login de Dex',
    accion: async (page) => {
      await page.getByText(/Sign in with Dex/).click();
      await page.waitForURL(/localhost:5556/);
      await page.fill('input[name="login"]', 'beto@tianguis.local');
      await page.fill('input[name="password"]', 'beto-2026');
    },
    imagen: 23,
  },
  {
    tipo: 'web',
    sitio: 'grafanaTls',
    nota: 'beto entra como Viewer',
    accion: async (page, ayudas) => {
      await page.getByRole('button', { name: /Login/i }).click();
      await page.waitForURL(new RegExp(`localhost:${GRAFANA}`));
      await page.goto(ayudas.urlDe('grafanaTls', '/profile'));
      await page.getByText('Synced via Generic OAuth').first().waitFor();
      await page.getByText('Organizations').first().waitFor();
      await page.getByText('Viewer', { exact: true }).first().waitFor();
      await sinPuntero(page);
    },
    recorte: 'pagina',
    imagen: 24,
  },
  {
    tipo: 'web',
    sitio: 'grafanaTls',
    nota: 'admin ve al usuario creado por OAuth',
    accion: async (page, ayudas) => {
      await comoAdmin(page, ayudas);
      await page.goto(ayudas.urlDe('grafanaTls', '/login'));
      await page.fill('input[name="user"]', 'admin');
      await page.fill('input[name="password"]', ayudas.correr(`${LIB}; leer_env GRAFANA_ADMIN_PASSWORD`).salida.trim());
      await page.click('button[type="submit"]');
      await page.waitForURL((u) => !u.pathname.startsWith('/login'));
      ayudas.marcarSesion('grafanaTls');
      await page.goto(ayudas.urlDe('grafanaTls', '/admin/users'));
      await page.getByText('beto@tianguis.local').first().waitFor();
      await sinPuntero(page);
    },
    recorte: alto(520),
    imagen: 25,
  },
  // --- Paso 8. Roles, equipo y carpeta restringida -----------------------------------------
  {
    tipo: 'web',
    sitio: 'grafanaTls',
    url: '/admin/users/create',
    nota: 'usuario vera',
    accion: async (page) => {
      await page.locator('input[name="name"]').fill('Vera');
      await page.locator('input[name="email"]').fill('vera@tianguis.local');
      await page.locator('input[name="login"]').fill('vera');
      await page.locator('input[name="password"]').fill('vera-2026');
      await sinPuntero(page);
    },
    recorte: alto(560),
    imagen: 26,
  },
  {
    tipo: 'web',
    sitio: 'grafanaTls',
    nota: 'crear vera y edu',
    accion: async (page, ayudas) => {
      await page.getByRole('button', { name: 'Create user' }).click();
      await page.waitForURL(/\/admin\/users\/edit\//);
      await page.goto(ayudas.urlDe('grafanaTls', '/admin/users/create'));
      await page.locator('input[name="name"]').fill('Edu');
      await page.locator('input[name="email"]').fill('edu@tianguis.local');
      await page.locator('input[name="login"]').fill('edu');
      await page.locator('input[name="password"]').fill('edu-2026');
      await page.getByRole('button', { name: 'Create user' }).click();
      await page.waitForURL(/\/admin\/users\/edit\//);
    },
  },
  {
    tipo: 'web',
    sitio: 'grafanaTls',
    url: '/org/users',
    nota: 'edu pasa a Editor',
    accion: async (page) => {
      await page.getByTestId('data-testid org-users-tab').click();
      const fila = page.getByRole('row').filter({ hasText: 'edu@tianguis.local' });
      await fila.getByLabel('Role').click({ force: true });
      await page.getByRole('option', { name: 'Editor', exact: true }).waitFor();
      await page.keyboard.type('Editor');
      await page.keyboard.press('Enter');
      await page.getByText(/Organization user updated/).waitFor().catch(() => {});
      await page.getByRole('row').filter({ hasText: 'vera@tianguis.local' }).waitFor();
      await sinPuntero(page);
    },
    recorte: alto(560),
    imagen: 27,
  },
  {
    tipo: 'web',
    sitio: 'grafanaTls',
    url: '/org/teams/new',
    nota: 'equipo con edu',
    accion: async (page, ayudas) => {
      await page.locator('input[name="name"]').fill('equipo-pagos');
      await page.getByRole('button', { name: 'Create' }).click();
      await page.getByText('Team created successfully').waitFor();
      await page.goto(ayudas.urlDe('grafanaTls', '/org/teams'));
      await page.getByRole('link', { name: 'equipo-pagos' }).first().click();
      await page.waitForURL(/\/org\/teams\/edit\//);
      await page.getByRole('button', { name: /Add member/ }).click();
      // El primer selector elige el tipo de miembro y solo ofrece User. Después aparece el
      // selector de personas. Los dos se abren con un clic real del mouse.
      // El panel entra animado. Un clic durante la animación no abre el selector.
      await page.waitForTimeout(1500);
      const tipo = await page.getByText('Choose', { exact: true }).boundingBox();
      await page.mouse.click(tipo.x + 20, tipo.y + tipo.height / 2);
      await page.getByText('User', { exact: true }).last().waitFor();
      const usuario = await page.getByText('User', { exact: true }).last().boundingBox();
      await page.mouse.click(usuario.x + 10, usuario.y + usuario.height / 2);
      await page.getByLabel('User picker').click({ force: true });
      await page.keyboard.type('edu', { delay: 100 });
      await page.getByRole('option', { name: /edu/i }).first().click();
      await page.getByRole('button', { name: 'Save' }).click();
      await page.getByRole('row').filter({ hasText: 'edu' }).first().waitFor();
      await page.getByText('Permission updated').waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
      await sinPuntero(page);
    },
    recorte: alto(520),
    imagen: 28,
  },
  {
    tipo: 'web',
    sitio: 'grafanaTls',
    url: '/dashboards',
    nota: 'carpeta restringida',
    accion: async (page) => {
      await page.getByRole('button', { name: 'New' }).last().click();
      await page.getByRole('menuitem', { name: 'New folder' }).click();
      await page.getByTestId('data-testid new-folder-name-input').fill('Pagos restringido');
      await page.getByRole('button', { name: 'Create' }).click();
      await page.waitForURL(/\/dashboards\/f\//);
      await page.getByRole('button', { name: /Folder actions/ }).click();
      await page.getByRole('menuitem', { name: /Manage permissions/ }).click();
      const cajon = page.getByRole('dialog');
      for (const rol of ['Editor', 'Viewer']) {
        await cajon.getByRole('button', { name: new RegExp(`Remove permission for ${rol}`) }).click();
        const confirmar = page.getByRole('button', { name: /^(Remove|Delete|Confirm)$/ });
        if (await confirmar.isVisible().catch(() => false)) await confirmar.click();
      }
      await cajon.getByRole('button', { name: /Add a permission/ }).click();
      await sinPuntero(page);
    },
    imagen: 29,
  },
  {
    tipo: 'web',
    sitio: 'grafanaTls',
    nota: 'permiso Edit para el equipo',
    accion: async (page) => {
      const cajon = page.getByRole('dialog');
      await page.waitForTimeout(1500);
      const tipo = await cajon.getByText('Choose', { exact: true }).boundingBox();
      await page.mouse.click(tipo.x + 20, tipo.y + tipo.height / 2);
      await page.getByText('Team', { exact: true }).last().waitFor();
      const equipo = await page.getByText('Team', { exact: true }).last().boundingBox();
      await page.mouse.click(equipo.x + 10, equipo.y + equipo.height / 2);
      await page.waitForTimeout(800);
      await cajon.getByLabel(/Team picker|Select a team/i).first().click({ force: true });
      await page.keyboard.type('equipo', { delay: 100 });
      await page.getByRole('option', { name: /equipo-pagos/ }).first().click();
      await cajon.getByLabel('Permission level').click({ force: true });
      await page.getByRole('option', { name: 'Edit', exact: true }).click();
      await cajon.getByRole('button', { name: 'Save' }).click();
      await cajon.getByText('Loading permissions').waitFor({ state: 'hidden' }).catch(() => {});
      await cajon.getByRole('row').filter({ hasText: 'equipo-pagos' }).first().waitFor();
      await page.getByText('Permission updated').waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
      await sinPuntero(page);
    },
    imagen: 30,
  },
  {
    tipo: 'web',
    sitio: 'grafanaTls',
    url: '/dashboard/import',
    nota: 'Host · USE dentro de la carpeta',
    accion: async (page, ayudas) => {
      await page.locator('input[type="file"]').setInputFiles(ayudas.rutaDelRepo('Capitulo4/sin-internet/host-use.json'));
      await page.getByTestId('data-testid folder-picker-trigger-button').click().catch(async () => page.getByText(/Dashboards|Select folder/).last().click());
      await page.getByText('Pagos restringido').last().click();
      await sinPuntero(page);
    },
    imagen: 31,
  },
  {
    tipo: 'web',
    sitio: 'grafanaTls',
    nota: 'importar',
    accion: async (page) => {
      await page.getByRole('button', { name: /^Import/ }).last().click();
      await page.waitForURL(/\/d\//);
      await page.waitForLoadState('networkidle').catch(() => {});
    },
  },
  {
    tipo: 'web',
    sitio: 'grafanaTls',
    nota: 'vera no ve la carpeta',
    accion: async (page, ayudas) => {
      await entrarComo(page, ayudas, 'vera', 'vera-2026');
      await page.goto(ayudas.urlDe('grafanaTls', '/dashboards'));
      await page.getByText('Tianguis · RED').or(page.getByText(/No results|dashboards/i)).first().waitFor();
      await page.waitForTimeout(1000);
      await sinPuntero(page);
    },
    recorte: alto(560),
    imagen: 32,
  },
  {
    tipo: 'web',
    sitio: 'grafanaTls',
    nota: 'edu sí la ve y puede editar',
    accion: async (page, ayudas) => {
      await entrarComo(page, ayudas, 'edu', 'edu-2026');
      await page.goto(ayudas.urlDe('grafanaTls', '/dashboards'));
      await page.getByText('Pagos restringido').first().click();
      await page.getByText('Host · USE').first().waitFor();
      await sinPuntero(page);
    },
    recorte: alto(560),
    imagen: 33,
  },

  // --- Paso 9. Cuenta de servicio y token ---------------------------------------------------
  {
    tipo: 'web',
    sitio: 'grafanaTls',
    nota: 'cuenta de servicio repartidor con su token',
    accion: async (page, ayudas) => {
      await comoAdmin(page, ayudas);
      await page.goto(ayudas.urlDe('grafanaTls', '/login'));
      await page.fill('input[name="user"]', 'admin');
      await page.fill('input[name="password"]', ayudas.correr(`${LIB}; leer_env GRAFANA_ADMIN_PASSWORD`).salida.trim());
      await page.click('button[type="submit"]');
      await page.waitForURL((u) => !u.pathname.startsWith('/login'));
      ayudas.marcarSesion('grafanaTls');
      await page.goto(ayudas.urlDe('grafanaTls', '/org/serviceaccounts/create'));
      await page.locator('input[name="name"]').fill('repartidor');
      await page.getByRole('button', { name: 'Create' }).click();
      await page.waitForURL(/\/org\/serviceaccounts\/[^c]/);
      await page.getByRole('button', { name: /Add service account token/ }).click();
      // El diálogo entra animado. El clic de prueba espera a que deje de moverse.
      await page.getByRole('button', { name: /Generate token/ }).click({ trial: true });
      await page.getByRole('button', { name: /Generate token/ }).click();
      await page.waitForFunction(() => [...document.querySelectorAll('[role="dialog"] input')].some((i) => i.value.startsWith('glsa_')));
      const token = await page.evaluate(() => [...document.querySelectorAll('[role="dialog"] input')].map((i) => i.value).find((v) => v.startsWith('glsa_')));
      // El alumno pega el token en un archivo.
      const r = ayudas.correr(`printf '%s' '${token}' > Capitulo7/trabajo/token-repartidor`);
      if (r.codigo !== 0) throw new Error(r.salida);
    },
    imagen: 34,
  },
  {
    tipo: 'terminal',
    comando: `curl -s --cacert ${CA} -H "Authorization: Bearer $(cat ${T}/token-repartidor)" "https://localhost:${GRAFANA}/api/search?query=Tianguis"`,
    contiene: 'Tianguis',
    imagen: 35,
  },
  {
    tipo: 'web',
    sitio: 'grafanaTls',
    nota: 'revocar el token',
    accion: async (page, ayudas) => {
      const dialogo = page.getByRole('dialog');
      if (await dialogo.isVisible().catch(() => false)) {
        await dialogo.getByRole('button', { name: /Close/ }).last().click();
      } else {
        await page.goto(ayudas.urlDe('grafanaTls', '/org/serviceaccounts'));
        await page.getByRole('link', { name: 'repartidor' }).first().click();
      }
      await page.getByText('Tokens', { exact: true }).waitFor();
      await page.getByRole('button', { name: /Delete service account token|Delete token/ }).first().click();
      await page.getByRole('button', { name: /^Delete$/ }).last().click();
      await page.getByText(/No tokens|no tokens|haven't/i).first().waitFor().catch(() => {});
      await sinPuntero(page);
    },
    recorte: alto(520),
    imagen: 36,
  },
  {
    tipo: 'terminal',
    comando: `curl -s -o /dev/null -w '%{http_code}\\n' --cacert ${CA} -H "Authorization: Bearer $(cat ${T}/token-repartidor)" "https://localhost:${GRAFANA}/api/search?query=Tianguis"`,
    contiene: '401',
    imagen: 37,
  },

  // --- Paso 10. Secretos en archivos -------------------------------------------------------
  {
    tipo: 'terminal',
    comando: `mkdir -p ${T}/secretos
printf '%s' 'raspar-2026' > ${T}/secretos/raspar
printf '%s' 'mirar-2026' > ${T}/secretos/mirar
printf '%s' 'secreto-de-grafana-2026' > ${T}/secretos/oauth_grafana
grep '^GRAFANA_ADMIN_PASSWORD=' infra/.env | cut -d= -f2- | tr -d '\\r\\n' > ${T}/secretos/grafana_admin
chmod 644 ${T}/secretos/*
ls -l ${T}/secretos`,
    contiene: 'oauth_grafana',
    imagen: 38,
  },
  escribir('el alumno pasa las claves de prometheus.yml a password_file', 'prometheusYml', `${T}/prometheus/prometheus.yml`, 10),
  escribir('el alumno pasa la clave del datasource a $__file', 'datasources', `${T}/grafana/datasources/datasources.yaml`, 10),
  escribir('el alumno escribe compose.seguridad.yaml, etapa 10', 'compose', 'Capitulo7/compose.seguridad.yaml', 10),
  { tipo: 'terminal', nota: 'aplicar la capa', comando: CAPA },
  sanos,
  { tipo: 'terminal', comando: "grep -n -i -E 'password|secret' Capitulo7/compose.seguridad.yaml", imagen: 39 },

  // --- Paso 11. La superficie otra vez -----------------------------------------------------
  {
    tipo: 'terminal',
    comando: `curl -s -o /dev/null -w 'node_exporter por http   %{http_code}\\n' http://localhost:9100/metrics
curl -s -o /dev/null -w 'node_exporter sin clave  %{http_code}\\n' --cacert ${CA} https://localhost:9100/metrics
curl -s -o /dev/null -w 'configuración sin clave  %{http_code}\\n' --cacert ${CA} https://localhost:${PROMETHEUS}/api/v1/status/config
curl -s -o /dev/null -w 'destinos sin clave       %{http_code}\\n' --cacert ${CA} https://localhost:${PROMETHEUS}/api/v1/targets`,
    contiene: '401',
    imagen: 40,
  },

  // --- Verificación ---------------------------------------------------------------------
  { tipo: 'terminal', nota: 'todos los destinos UP después de recrear Prometheus', comando: hasta(`[ "$(curl -s --cacert ${CA} -u tianguis:mirar-2026 'https://localhost:${PROMETHEUS}/api/v1/targets?state=active' | grep -o '"health":"[a-z]*"' | grep -c -v '"up"')" = 0 ]`, 120) },
  { tipo: 'terminal', comando: 'Capitulo7/verificar.sh', imagen: 41 },

  // --- Resultado esperado ---------------------------------------------------------------
  web('prometheusTls', '/targets', texto('https://alertmanager:9093/metrics'), 42, 'pagina'),

  // --- Volver al stack base -------------------------------------------------------------
  { tipo: 'terminal', comando: 'Capitulo7/restaurar.sh', entrada: 'SI\n', imagen: 43, ultimas: 12 },
];

