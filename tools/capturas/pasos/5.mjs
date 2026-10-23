// Práctica 5. Alertas de un microservicio con Alertmanager y Grafana Alerting.
// Cada paso: tipo, sitio y url (o comando), espera, acción, recorte y número de imagen.
// Los pasos sin imagen hacen lo que el alumno hace a mano entre una captura y la siguiente.
// Lo que el alumno escribe en un editor, aquí se copia desde Capitulo5/solucion.
//
// Las alertas suenan con sus tiempos reales. Las esperas son por condición y algunas duran
// varios minutos. La corrida completa tarda más de media hora.

import { PROMETHEUS } from './puertos.mjs';

const LIB = '. _comun/lib-practicas.sh';
const SOL = 'Capitulo5/solucion';
const TITULO = 'Tianguis · Alertas';
const P95_PAGOS = 'histogram_quantile(0.95, sum by (le) (rate(http_server_request_duration_seconds_bucket{job="pagos", http_route="/pagos"}[5m])))';
const PLANTILLA = [
  '{{ define "tianguis.resumen" }}',
  '{{ range .Alerts }}[{{ .Status }}] {{ .Labels.alertname }}',
  '{{ .Annotations.summary }}',
  'Desde las {{ .StartsAt.Format "15:04:05" }} UTC',
  '{{ end }}',
  '{{ end }}',
];

// --- Prometheus ------------------------------------------------------------------------------

function consulta(exprs, tab = 'table', rango = '30m') {
  const lista = Array.isArray(exprs) ? exprs : [exprs];
  const partes = lista.map((e, i) =>
    `g${i}.expr=${encodeURIComponent(e)}&g${i}.tab=${tab}&g${i}.range_input=${rango}`);
  return `/query?${partes.join('&')}`;
}

const resultados = (n) => async (page) => {
  await page.waitForFunction((total) => {
    const listos = [...document.querySelectorAll('body *')].filter((e) =>
      e.children.length === 0 && /Result series: \d+|Empty query result/.test(e.textContent));
    return listos.length >= total;
  }, n);
};
const graficos = (n) => async (page) => {
  await page.waitForFunction((total) => document.querySelectorAll('.u-over').length >= total, n);
};

const web = (sitio, url, espera, imagen, recorte, accion) => ({ tipo: 'web', sitio, url, espera, accion, imagen, recorte });
const prom = (url, espera, imagen, recorte) => web('prometheus', url, espera, imagen, recorte);
const alto = (h) => ({ x: 0, y: 0, width: 1440, height: h });
const texto = (t) => async (page) => { await page.getByText(t).filter({ visible: true }).first().waitFor(); };

// Espera con tope a que una condición de bash se cumpla.
const hasta = (condicion, tope = 600) =>
  `${LIB}; n=0; until ${condicion}; do n=$((n + 3)); [ "$n" -lt ${tope} ] || exit 1; sleep 3; done`;
const existe = (expr) => `prom_existe '${expr}'`;
const alerta = (nombre, job, estado) => `ALERTS{alertname="${nombre}", job="${job}", alertstate="${estado}"}`;
const AM = 'docker exec gpe-alertmanager amtool --alertmanager.url=http://localhost:9093';
const enWebhook = (patron) => `docker logs gpe-webhook 2>&1 | grep '"receiver":"tienda-webhook"' | grep -q '${patron}'`;
const enMailpit = (patron) => `curl -s "http://localhost:$(leer_env PUERTO_MAILPIT_UI)/api/v1/messages" | grep -q '${patron}'`;

// Así lo escribe el alumno, con la URL de Alertmanager dentro del contenedor.
const AM_ALUMNO = 'docker exec gpe-alertmanager amtool --alertmanager.url=http://localhost:9093';

// Explore con una consulta de Loki.
function explorarLoki(expr) {
  const panes = { a: { datasource: 'loki', queries: [{ refId: 'A', expr, queryType: 'range', datasource: { type: 'loki', uid: 'loki' } }], range: { from: 'now-30m', to: 'now' } } };
  return `/explore?schemaVersion=1&orgId=1&panes=${encodeURIComponent(JSON.stringify(panes))}`;
}
const lineasDeLogs = async (page) => {
  await page.locator('[data-testid="logRows"], [class*="logs-row"], [data-testid="log-line"]').first().waitFor();
};

// --- Grafana -----------------------------------------------------------------------------------


async function escribirConsulta(page, ayudas, expr) {
  await page.getByTestId('data-testid radio-button-option code').click({ force: true });
  const editor = page.locator('.monaco-editor').first();
  await page.locator('.monaco-editor textarea').first().waitFor({ state: 'attached' });
  await editor.click();
  await page.keyboard.type(expr);
  await editor.click();
  await ayudas.conConsulta(page, () => page.keyboard.press('Shift+Enter'));
}

async function elegirVisualizacion(page, nombre) {
  await page.getByRole('tab', { name: 'All visualizations' }).click();
  await page.getByTestId('data-testid Panel editor viz type picker search input').fill(nombre);
  await page.getByTestId(`data-testid Plugin visualization item ${nombre}`).click();
}

const titular = (page, titulo) => page.getByTestId('data-testid Panel editor option pane field input Title').fill(titulo);
const volver = (page) => page.getByTestId('data-testid Back to dashboard button').click();
const sinPuntero = (page) => page.mouse.move(720, 890);

// Escribe en un editor Monaco línea por línea. Monaco cierra solo las llaves: lo que queda a la
// derecha del cursor se borra antes de pasar a la línea siguiente.
async function escribirLineas(page, lineas) {
  for (const linea of lineas) {
    await page.keyboard.insertText(linea);
    await page.keyboard.press('Shift+End');
    await page.keyboard.press('Delete');
    await page.keyboard.press('Enter');
  }
}

async function etiqueta(page, dialogo, i, clave, valor) {
  if (i > 0) await dialogo.getByRole('button', { name: 'Add more' }).click();
  await dialogo.getByTestId('alertlabel-key-combobox').nth(i).fill(clave);
  await page.getByRole('option', { name: new RegExp(clave) }).first().waitFor();
  await page.keyboard.press('Enter');
  await dialogo.getByTestId('alertlabel-value-combobox').nth(i).fill(valor);
  await page.getByRole('option', { name: new RegExp(valor) }).first().waitFor();
  await page.keyboard.press('Enter');
}

const GRAFANA_API = (ruta, extra = '') => `grafana_api "${ruta}" ${extra} >/dev/null`;

export default [
  // --- Dejar todo como antes de empezar la práctica -------------------------------------
  { tipo: 'terminal', nota: 'devolver catalogo, reglas y Alertmanager a git', comando: 'Capitulo5/restaurar.sh', entrada: 'SI\n' },
  {
    tipo: 'terminal',
    nota: 'borrar en Grafana y Alertmanager lo de una corrida anterior',
    comando: `${LIB}
      while uid="$(grafana_dashboard_existe "${TITULO}")"; do grafana_api "/api/dashboards/uid/$uid" -X DELETE >/dev/null; done
      for uid in $(grafana_api /api/v1/provisioning/alert-rules | grep -o '"uid":"[^"]*","orgID":[0-9]*,"folderUID":"[^"]*","ruleGroup":"pagos"' | cut -d'"' -f4); do
        ${GRAFANA_API('/api/v1/provisioning/alert-rules/$uid', '-X DELETE')}
      done
      ${GRAFANA_API('/api/v1/provisioning/policies', '-X DELETE')}
      for uid in $(grafana_api /api/v1/provisioning/contact-points | grep -o '"uid":"[^"]*","name":"equipo-pagos"' | cut -d'"' -f4); do
        ${GRAFANA_API('/api/v1/provisioning/contact-points/$uid', '-X DELETE')}
      done
      ${GRAFANA_API('/api/v1/provisioning/templates/tianguis-resumen', '-X DELETE')}
      for uid in $(grafana_api /api/folders | grep -o '"uid":"[^"]*","title":"Tianguis"' | cut -d'"' -f4); do
        ${GRAFANA_API('/api/folders/$uid', '-X DELETE')}
      done
      ${AM} silence expire $(${AM} silence query -q) 2>/dev/null
      curl -s -X DELETE "http://localhost:$(leer_env PUERTO_MAILPIT_UI)/api/v1/messages" >/dev/null
      # Un contenedor nuevo empieza con los logs vacíos: las esperas no ven notificaciones viejas.
      compose up -d --force-recreate --no-deps webhook >/dev/null 2>&1
      true`,
  },

  // --- Punto de partida -----------------------------------------------------------------
  { tipo: 'terminal', comando: 'Capitulo5/preparar.sh', imagen: 1 },
  // Si se repite la corrida, catalogo todavía puede tener errores en la ventana de 5 minutos.
  { tipo: 'terminal', nota: 'ventana de 5 minutos sin errores de catalogo', comando: hasta(`! ${existe('sum(rate(http_server_requests_total{job="catalogo", ambiente="prod", status=~"5.."}[5m])) > 0')}`, 420) },

  // --- Parte A. Paso 1. El counter nuevo en catalogo ------------------------------------
  {
    tipo: 'terminal',
    nota: 'el alumno edita metricas.py y rutas.py',
    comando: `cp ${SOL}/servicios/catalogo/src/catalogo/metricas.py servicios/catalogo/src/catalogo/metricas.py
      cp ${SOL}/servicios/catalogo/src/catalogo/api/rutas.py servicios/catalogo/src/catalogo/api/rutas.py`,
  },
  { tipo: 'terminal', comando: 'git diff servicios/catalogo', imagen: 2 },
  { tipo: 'terminal', comando: 'bin/up.sh', imagen: 3, ultimas: 24 },
  {
    tipo: 'terminal',
    comando: 'for sku in TNG-0001 TNG-0007 TNG-0013 TNG-0019; do curl -s http://localhost:8001/productos/$sku; echo; done',
    imagen: 4,
  },
  { tipo: 'terminal', comando: 'curl -s http://localhost:8001/metrics | grep catalog_product_views', imagen: 5 },
  { tipo: 'terminal', nota: 'Prometheus raspa la métrica nueva con varias categorías', comando: hasta(existe('count(catalog_product_views_total{ambiente="prod"}) >= 3'), 180) },
  prom(consulta('sum by (category) (catalog_product_views_total{ambiente="prod"})'), resultados(1), 6, alto(330)),

  // --- Paso 2. Las métricas de pagos con OpenTelemetry ----------------------------------
  {
    tipo: 'terminal',
    comando: "grep -n -A4 'Builder(\"payments' servicios/pagos/src/main/java/mx/tianguis/pagos/telemetria/MetricasDePagos.java",
    imagen: 7,
  },
  prom(consulta('sum by (payment_method, payment_result) (payments_processed_total)'), resultados(1), 8, alto(420)),

  // --- Paso 3. OTLP a mano --------------------------------------------------------------
  { tipo: 'terminal', comando: "sed -n '/^otlp:/,/^rule_files:/p' infra/prometheus/prometheus.yml", imagen: 9 },
  {
    tipo: 'terminal',
    comando: `curl -s -o /dev/null -w '%{http_code}\\n' -X POST http://localhost:${PROMETHEUS}/api/v1/otlp/v1/metrics \\
  -H 'Content-Type: application/json' \\
  -d '{"resourceMetrics":[{"resource":{"attributes":[{"key":"service.name","value":{"stringValue":"refrigerador"}}]},"scopeMetrics":[{"metrics":[{"name":"tianguis.refrigerador.temperatura","unit":"Cel","gauge":{"dataPoints":[{"asDouble":4.5,"timeUnixNano":"'"$(date +%s)"'000000000","attributes":[{"key":"pasillo","value":{"stringValue":"3"}}]}]}}]}]}]}'`,
    contiene: '200',
    imagen: 10,
  },
  prom(consulta('{__name__=~"tianguis_refrigerador.*"}'), resultados(1), 11, alto(300)),

  // --- Paso 4. Pushgateway --------------------------------------------------------------
  {
    tipo: 'terminal',
    comando: "echo 'tianguis_corte_de_caja_mxn 15230.50' | curl -s -w '%{http_code}\\n' --data-binary @- http://localhost:9091/metrics/job/corte_de_caja/puesto/pasillo3",
    contiene: '200',
    imagen: 12,
  },
  web('pushgateway', '/', texto('corte_de_caja'), 13, alto(520)),
  { tipo: 'terminal', nota: 'Prometheus raspa el grupo nuevo', comando: hasta(existe('tianguis_corte_de_caja_mxn'), 60) },
  prom(consulta('tianguis_corte_de_caja_mxn'), resultados(1), 14, alto(300)),
  {
    tipo: 'terminal',
    comando: "curl -s -w '%{http_code}\\n' -X DELETE http://localhost:9091/metrics/job/corte_de_caja/puesto/pasillo3",
    contiene: '202',
    imagen: 15,
  },
  web('pushgateway', '/', texto('conciliacion'), 16, alto(520), async (page) => {
    await page.getByText('corte_de_caja').waitFor({ state: 'detached' });
  }),

  // --- Paso 5. Reglas de registro -------------------------------------------------------
  { tipo: 'terminal', nota: 'el alumno crea tianguis-registro.yml', comando: `cp ${SOL}/infra/prometheus/rules/tianguis-registro.yml infra/prometheus/rules/` },
  {
    tipo: 'terminal',
    comando: 'MSYS_NO_PATHCONV=1 docker exec gpe-prometheus promtool check rules /etc/prometheus/rules/tianguis-registro.yml',
    contiene: 'SUCCESS',
    imagen: 17,
  },
  { tipo: 'terminal', comando: 'docker exec gpe-prometheus kill -HUP 1' },
  { tipo: 'terminal', nota: 'Prometheus evalúa las reglas', comando: hasta(existe('job:http_server_errors:ratio_rate5m'), 120) },
  prom('/rules', texto('job:http_server_errors:ratio_rate5m'), 18, alto(620)),
  prom(consulta(['job:http_server_requests:rate5m', 'job:http_server_errors:ratio_rate5m']), resultados(2), 19, 'pagina'),

  // --- Parte B. Paso 6. Reglas de alerta ------------------------------------------------
  { tipo: 'terminal', nota: 'el alumno crea tianguis-alertas.yml', comando: `cp ${SOL}/infra/prometheus/rules/tianguis-alertas.yml infra/prometheus/rules/` },
  {
    tipo: 'terminal',
    comando: 'MSYS_NO_PATHCONV=1 docker exec gpe-prometheus promtool check rules /etc/prometheus/rules/tianguis-alertas.yml',
    contiene: 'SUCCESS',
    imagen: 20,
  },
  { tipo: 'terminal', comando: 'docker exec gpe-prometheus kill -HUP 1' },
  { tipo: 'terminal', nota: 'Prometheus evalúa las tres alertas', comando: hasta(`[ "$(curl -s "$(prom_url)/api/v1/rules?type=alert" | grep -o '"health":"ok"' | wc -l)" -ge 3 ]`, 120) },
  prom('/alerts', texto('inactive (3)'), 21, alto(560)),

  // --- Paso 7. Pruebas unitarias --------------------------------------------------------
  {
    tipo: 'terminal',
    nota: 'el alumno crea las pruebas',
    comando: `mkdir -p infra/prometheus/pruebas && cp ${SOL}/infra/prometheus/pruebas/tianguis-alertas.test.yml infra/prometheus/pruebas/`,
  },
  {
    tipo: 'terminal',
    comando: 'MSYS_NO_PATHCONV=1 docker exec gpe-prometheus promtool test rules /etc/prometheus/pruebas/tianguis-alertas.test.yml',
    contiene: 'SUCCESS',
    imagen: 22,
  },
  { tipo: 'terminal', nota: 'el alumno sube el umbral a 0.40', comando: "sed -i.bak 's/ratio_rate5m > 0.10/ratio_rate5m > 0.40/' infra/prometheus/rules/tianguis-alertas.yml && rm infra/prometheus/rules/tianguis-alertas.yml.bak" },
  {
    tipo: 'terminal',
    comando: 'MSYS_NO_PATHCONV=1 docker exec gpe-prometheus promtool test rules /etc/prometheus/pruebas/tianguis-alertas.test.yml',
    sale: 1,
    contiene: 'FAILED',
    imagen: 23,
    ultimas: 30,
  },
  { tipo: 'terminal', nota: 'el alumno lo devuelve a 0.10', comando: `cp ${SOL}/infra/prometheus/rules/tianguis-alertas.yml infra/prometheus/rules/` },

  // --- Paso 8. Alertmanager -------------------------------------------------------------
  { tipo: 'terminal', nota: 'el alumno reemplaza alertmanager.yml', comando: `cp ${SOL}/infra/alertmanager/alertmanager.yml infra/alertmanager/alertmanager.yml` },
  {
    tipo: 'terminal',
    comando: 'MSYS_NO_PATHCONV=1 docker exec gpe-alertmanager amtool check-config /etc/alertmanager/alertmanager.yml',
    contiene: 'SUCCESS',
    imagen: 24,
  },
  { tipo: 'terminal', comando: "curl -s -w '%{http_code}\\n' -X POST http://localhost:9093/-/reload", contiene: '200' },
  { tipo: 'terminal', comando: `${AM_ALUMNO} config routes`, contiene: 'tienda-webhook', imagen: 25 },
  { tipo: 'terminal', comando: `${AM_ALUMNO} config routes test alertname=ErroresAltos team=tienda severity=advertencia`, contiene: 'tienda-webhook,guardia-correo', imagen: 26 },

  // --- Paso 9. El incidente de las 3 de la mañana ---------------------------------------
  { tipo: 'terminal', comando: 'bin/caos.sh catalogo errores porcentaje=30', contiene: 'ACTIVA', imagen: 27 },
  { tipo: 'terminal', nota: 'ErroresAltos en Pending', comando: hasta(existe(alerta('ErroresAltos', 'catalogo', 'pending')), 420) },
  prom('/alerts', texto('pending (1)'), 28, alto(560), async (page) => {
    await page.getByText('ErroresAltos').first().click();
    await page.getByText('job:http_server_errors:ratio_rate5m > 0.10').filter({ visible: true }).first().waitFor();
  }),
  { tipo: 'terminal', nota: 'ErroresAltos en Firing', comando: hasta(existe(alerta('ErroresAltos', 'catalogo', 'firing')), 300) },
  prom('/alerts', texto('firing (1)'), 29, alto(620), async (page) => {
    await page.getByText('ErroresAltos').first().click();
    await page.getByText('job:http_server_errors:ratio_rate5m > 0.10').filter({ visible: true }).first().waitFor();
  }),
  { tipo: 'terminal', nota: 'la notificación llega al webhook y al correo', comando: hasta(`${enWebhook('"alertnames":"ErroresAltos"')} && ${enMailpit('FIRING:1\\] ErroresAltos catalogo')}`, 180) },
  web('alertmanager', '/#/alerts', texto('ErroresAltos'), 30, alto(520)),
  web('mailpit', '/', texto('ErroresAltos catalogo'), 31, alto(420)),
  web('mailpit', '/', texto('ErroresAltos catalogo'), 32, alto(900), async (page) => {
    await page.getByText(/FIRING:1\] ErroresAltos catalogo/).first().click();
    await page.getByText('guardia@tianguis.local').first().waitFor();
    await page.frameLocator('iframe').first().getByText('ErroresAltos').first().waitFor();
  }),
  web('grafana', explorarLoki('{compose_service="webhook"} | json | receiver="tienda-webhook"'), lineasDeLogs, 33, alto(900)),

  // catalogo se cae.
  { tipo: 'terminal', comando: 'docker stop gpe-catalogo', imagen: 34 },
  { tipo: 'terminal', nota: 'CatalogoCaido inhibe a ErroresAltos de catalogo', comando: hasta(`curl -s 'http://localhost:9093/api/v2/alerts?inhibited=true' | grep -q '"inhibitedBy":\\["'`, 300) },
  web('alertmanager', '/#/alerts?silenced=false&inhibited=true&active=true', texto('CatalogoCaido'), 35, alto(620)),
  { tipo: 'terminal', comando: `${AM_ALUMNO} alert query --inhibited`, contiene: 'suppressed', imagen: 36 },

  // Silencio para pedidos.
  {
    tipo: 'terminal',
    comando: `${AM_ALUMNO} silence add alertname=ErroresAltos job=pedidos --duration=30m --author=guardia --comment="pedidos falla porque catalogo está caído"`,
    imagen: 37,
  },
  web('alertmanager', '/#/silences', texto('pedidos'), 38, alto(520)),
  { tipo: 'terminal', comando: `${AM_ALUMNO} alert query --silenced`, contiene: 'suppressed', imagen: 39 },

  // Todo vuelve a la normalidad.
  { tipo: 'terminal', comando: 'bin/up.sh', imagen: 40, ultimas: 6 },
  { tipo: 'terminal', comando: 'bin/caos.sh apagar', imagen: 41, ultimas: 3 },
  { tipo: 'terminal', nota: 'llegan los resueltos', comando: hasta(`${enWebhook('"status":"resolved","alertas":1,"alertnames":"CatalogoCaido"')} && ${enWebhook('"status":"resolved","alertas":1,"alertnames":"ErroresAltos"')}`, 600) },
  web('mailpit', '/', texto('RESOLVED'), 42, alto(520)),
  web('grafana', explorarLoki('{compose_service="webhook"} | json | receiver="tienda-webhook" | status="resolved"'), lineasDeLogs, 43, alto(900)),
  { tipo: 'terminal', comando: `docker exec gpe-alertmanager sh -c 'amtool silence expire $(amtool silence query -q --alertmanager.url=http://localhost:9093) --alertmanager.url=http://localhost:9093'` },

  // --- Paso 10. La falla silenciosa con alarma ------------------------------------------
  { tipo: 'terminal', comando: 'bin/caos.sh conciliacion fallar', contiene: 'ACTIVA', imagen: 44 },

  // --- Paso 11. Grafana Alerting. Plantilla ---------------------------------------------
  {
    tipo: 'web',
    sitio: 'grafana',
    url: '/alerting/notifications/templates/new',
    nota: 'plantilla de notificación',
    accion: async (page) => {
      await page.getByPlaceholder('Give your template group a name').fill('tianguis-resumen');
      await page.locator('.monaco-editor').first().click();
      await escribirLineas(page, PLANTILLA);
      await sinPuntero(page);
    },
    recorte: { x: 320, y: 48, width: 680, height: 500 },
    imagen: 45,
  },
  {
    tipo: 'web',
    sitio: 'grafana',
    nota: 'guardar la plantilla',
    accion: async (page) => {
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await page.getByText('tianguis-resumen').first().waitFor();
      await page.waitForURL((u) => !u.pathname.endsWith('/new'));
    },
  },

  // Punto de contacto con correo y webhook.
  {
    tipo: 'web',
    sitio: 'grafana',
    url: '/alerting/notifications/receivers/new',
    nota: 'punto de contacto, mensaje con la plantilla',
    accion: async (page) => {
      await page.getByTestId('data-testid contact-point-form name-input').fill('equipo-pagos');
      await page.getByTestId('data-testid contact-point-form settings-field items.0.settings.addresses').locator('textarea').fill('pagos@tianguis.local');
      await page.getByRole('button', { name: 'Optional Email settings' }).click();
      await page.getByRole('button', { name: 'Edit Message' }).click();
      await page.getByTestId('existing-templates-selector').click();
      await page.keyboard.type('tianguis');
      await page.getByRole('option', { name: 'tianguis.resumen' }).click();
      await page.getByRole('dialog').getByText('Desde las').first().waitFor();
    },
    imagen: 46,
  },
  {
    tipo: 'web',
    sitio: 'grafana',
    nota: 'punto de contacto con correo y webhook',
    accion: async (page) => {
      await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
      await page.getByRole('button', { name: 'Add contact point integration' }).click();
      await page.getByTestId('data-testid contact-point-form integration-type items.1.').click();
      await page.keyboard.type('Webhook');
      await page.keyboard.press('Enter');
      await page.locator('input[name="items.1.settings.url"]').fill('http://webhook:8080/grafana');
      await sinPuntero(page);
    },
    recorte: 'pagina',
    imagen: 47,
  },
  {
    tipo: 'web',
    sitio: 'grafana',
    nota: 'guardar el punto de contacto',
    accion: async (page) => {
      await page.getByTestId('data-testid contact-point-form save-button').click();
      await page.waitForURL((u) => !u.pathname.endsWith('/new'));
      await page.getByText('equipo-pagos').first().waitFor();
    },
  },

  // Política de notificación por etiqueta.
  {
    tipo: 'web',
    sitio: 'grafana',
    url: '/alerting/routes',
    nota: 'política team=pagos',
    accion: async (page) => {
      await page.getByRole('button', { name: 'Add route' }).first().click();
      const dialogo = page.getByRole('dialog');
      await dialogo.getByPlaceholder('label').fill('team');
      await dialogo.getByPlaceholder('value').fill('pagos');
      await dialogo.getByRole('combobox').nth(1).focus();
      await page.keyboard.type('equipo-pagos');
      await page.getByRole('option', { name: /equipo-pagos/ }).first().click();
      await sinPuntero(page);
    },
    imagen: 48,
  },
  {
    tipo: 'web',
    sitio: 'grafana',
    nota: 'árbol de políticas',
    accion: async (page) => {
      await page.getByRole('dialog').getByRole('button', { name: 'Add route' }).click();
      await page.getByRole('dialog').waitFor({ state: 'detached' });
      await page.getByText('equipo-pagos').first().waitFor();
      await page.getByText('Updated notification policies').waitFor({ state: 'hidden', timeout: 15000 });
      await sinPuntero(page);
    },
    recorte: alto(560),
    imagen: 49,
  },

  // Regla de Grafana sobre el p95 de pagos.
  {
    tipo: 'web',
    sitio: 'grafana',
    url: '/alerting/new/alerting',
    nota: 'regla, consulta y condición',
    accion: async (page) => {
      await page.getByTestId('data-testid alert-rule name-field').fill('PagosLentos');
      await page.getByTestId('data-testid radio-button-option code').click({ force: true });
      await page.locator('.monaco-editor textarea').first().waitFor({ state: 'attached' });
      await page.locator('.monaco-editor').first().click();
      await page.keyboard.type(P95_PAGOS);
      await page.keyboard.press('Escape');
      await page.getByTestId('data-testid alert-rule threshold-input').fill('1');
      await page.getByRole('button', { name: 'Preview alert rule condition' }).click();
      await page.getByText(/^(Normal|Firing|Alerting)$/).filter({ visible: true }).first().waitFor();
      await sinPuntero(page);
    },
    recorte: alto(900),
    imagen: 50,
  },
  {
    tipo: 'web',
    sitio: 'grafana',
    nota: 'carpeta y etiquetas',
    accion: async (page) => {
      await page.getByRole('button', { name: 'New folder' }).click();
      await page.getByRole('dialog').getByPlaceholder('Enter a name').fill('Tianguis');
      await page.getByRole('dialog').getByRole('button', { name: 'Create' }).click();
      await page.getByRole('dialog').waitFor({ state: 'detached' });
      await page.getByTestId('data-testid alert-rule add-labels-button').click();
      const dialogo = page.getByRole('dialog');
      await etiqueta(page, dialogo, 0, 'team', 'pagos');
      await etiqueta(page, dialogo, 1, 'severity', 'advertencia');
      await sinPuntero(page);
    },
    imagen: 51,
  },
  {
    tipo: 'web',
    sitio: 'grafana',
    nota: 'grupo de evaluación y ruteo por política',
    accion: async (page) => {
      await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
      await page.getByTestId('data-testid alert-rule new-evaluation-group-button').click();
      await page.getByTestId('data-testid alert-rule new-evaluation-group-name').fill('pagos');
      await page.getByTestId('data-testid alert-rule new-evaluation-group-create-button').click();
      await page.getByTestId('data-testid advanced-mode-switch step-5').click({ force: true });
      await page.getByText('Delivered to').first().waitFor();
      await page.getByPlaceholder('Enter a summary...').fill('El p95 de pagos está en {{ printf "%.2f" $values.A.Value }} segundos');
      await page.getByTestId('data-testid alert-rule step-4').evaluate((e) => e.scrollIntoView({ block: 'start' }));
      await sinPuntero(page);
    },
    imagen: 52,
  },
  {
    tipo: 'web',
    sitio: 'grafana',
    nota: 'regla guardada',
    accion: async (page) => {
      await page.getByTestId('data-testid alert-rule save-rule-button').click();
      await page.waitForURL((u) => !u.pathname.includes('/new'));
      await page.getByText('PagosLentos').first().waitFor();
      await sinPuntero(page);
    },
    recorte: alto(560),
    imagen: 53,
  },
  { tipo: 'terminal', comando: 'bin/caos.sh pagos pasarela_lenta ms=1500 porcentaje=50 duracion_s=900', contiene: 'ACTIVA', imagen: 54 },
  { tipo: 'terminal', nota: 'el correo de Grafana llega a Mailpit', comando: hasta(enMailpit('FIRING:1\\] PagosLentos'), 420) },
  web('grafana', '/alerting/list?search=PagosLentos', texto('PagosLentos'), 55, alto(560)),
  web('mailpit', '/', texto('PagosLentos'), 56, alto(900), async (page) => {
    await page.getByText(/PagosLentos/).first().click();
    await page.frameLocator('iframe').first().getByText('Desde las').first().waitFor();
  }),

  // --- Paso 12. Dashboard Tianguis · Alertas --------------------------------------------
  {
    tipo: 'web',
    sitio: 'grafana',
    url: '/dashboard/new?from=now-1h&to=now',
    nota: 'anotación a partir de chaos_active',
    accion: async (page) => {
      await page.getByRole('button', { name: 'Annotation query' }).click();
      const nombre = page.getByTestId('data-testid Sidebar container').getByRole('textbox').first();
      await nombre.fill('Caos');
      await nombre.blur();
      await page.getByRole('button', { name: 'Open query editor' }).click();
      const dialogo = page.getByRole('dialog');
      await dialogo.locator('.monaco-editor').first().click();
      await page.keyboard.type('max by (job, type) (chaos_active) > 0');
      await dialogo.getByPlaceholder('{{alertname}}').fill('Caos en {{job}}');
      await dialogo.getByPlaceholder('{{instance}}').fill('Falla {{type}}');
      // La consulta se aplica al salir del editor. Si la prueba sale antes, se repite.
      for (let intento = 0; intento < 10; intento += 1) {
        await dialogo.getByRole('button', { name: 'Test annotation query' }).click();
        const hay = await dialogo.getByText(/\d+ events/).waitFor({ timeout: 3000 }).then(() => true, () => false);
        if (hay) break;
      }
      await dialogo.getByText(/\d+ events/).waitFor();
    },
    imagen: 57,
  },
  {
    tipo: 'web',
    sitio: 'grafana',
    nota: 'panel de errores con las ventanas de caos',
    accion: async (page, ayudas) => {
      await page.getByRole('dialog').getByRole('button', { name: 'Close' }).last().click();
      await page.getByTestId('data-testid Dashboard Sidebar new button').click();
      await page.getByTestId('data-testid sidebar add new panel').click();
      await page.getByTestId('data-testid UnconfiguredPanel action-button configure').click();
      await escribirConsulta(page, ayudas, 'job:http_server_errors:ratio_rate5m');
      await elegirVisualizacion(page, 'Time series');
      await titular(page, 'Proporción de errores en prod');
      await sinPuntero(page);
    },
    imagen: 58,
  },
  {
    tipo: 'web',
    sitio: 'grafana',
    nota: 'panel Alert list',
    accion: async (page) => {
      await volver(page);
      await page.getByTestId('data-testid CanvasGridAddActions add-panel').last().click();
      await page.getByTestId('data-testid UnconfiguredPanel action-button configure').click();
      await elegirVisualizacion(page, 'Alert list');
      await titular(page, 'Alertas activas');
      await page.getByText('PagosLentos').first().waitFor();
      await sinPuntero(page);
    },
    imagen: 59,
  },
  {
    tipo: 'web',
    sitio: 'grafana',
    nota: 'guardar el dashboard',
    accion: async (page) => {
      await volver(page);
      await page.getByTestId('data-testid Save dashboard button').click();
      await page.getByTestId('data-testid Save dashboard title field').fill(TITULO);
      await page.getByRole('button', { name: 'Save', exact: true }).last().click();
      await page.waitForURL(/\/d\//);
      await page.getByText('Dashboard saved').waitFor({ state: 'hidden' });
      await page.getByRole('button', { name: 'Exit edit' }).click().catch(() => {});
      await sinPuntero(page);
    },
    imagen: 60,
  },

  // --- Vuelta al paso 10. ConciliacionSinExito ------------------------------------------
  { tipo: 'terminal', nota: 'ConciliacionSinExito llega al correo', comando: hasta(enMailpit('FIRING:1\\] ConciliacionSinExito'), 1200) },
  web('alertmanager', '/#/alerts', texto('ConciliacionSinExito'), 61, alto(520)),
  web('mailpit', '/', texto('ConciliacionSinExito'), 62, alto(900), async (page) => {
    await page.getByText(/FIRING:1\] ConciliacionSinExito/).first().click();
    await page.frameLocator('iframe').first().getByText('sin una corrida exitosa').first().waitFor();
  }),
  { tipo: 'terminal', comando: 'bin/caos.sh apagar', imagen: 63, ultimas: 12 },
  { tipo: 'terminal', nota: 'llegan los resueltos de conciliacion y de pagos', comando: hasta(`${enMailpit('RESOLVED\\] ConciliacionSinExito')} && ${enMailpit('RESOLVED\\] PagosLentos')}`, 900) },
  web('mailpit', '/', texto('RESOLVED] ConciliacionSinExito'), 64, alto(620)),

  // --- Verificación ---------------------------------------------------------------------
  { tipo: 'terminal', comando: 'Capitulo5/verificar.sh', imagen: 65 },

  // --- Resultado esperado ---------------------------------------------------------------
  {
    tipo: 'web',
    sitio: 'grafana',
    nota: 'dashboard Tianguis · Alertas',
    accion: async (page, ayudas) => {
      const uid = ayudas.correr(`${LIB}; grafana_dashboard_existe "${TITULO}"`).salida.trim();
      await page.goto(ayudas.urlDe('grafana', `/d/${uid}?from=now-1h&to=now`));
      await page.getByText('Alertas activas').first().waitFor();
      await page.getByText(/PagosLentos|No alerts matching filters/).first().waitFor();
      await sinPuntero(page);
    },
    imagen: 66,
  },
];
