// Práctica 2. Stack de Prometheus y Grafana con Docker Compose.
// Cada paso: tipo, sitio y url (o comando), espera, acción, recorte y número de imagen.
// Los pasos sin imagen hacen lo que el alumno hace a mano entre una captura y la siguiente.

const CONFIG = 'infra/prometheus/prometheus.yml';
const PROMTOOL = 'MSYS_NO_PATHCONV=1 docker exec gpe-prometheus promtool check config /etc/prometheus/prometheus.yml';
const LIB = '. _comun/lib-practicas.sh';
const TITULO = 'Tianguis · Primer vistazo';

const consulta = (expr, extra = 'g0.tab=table') => `/query?g0.expr=${encodeURIComponent(expr)}&${extra}`;
const conResultado = (page) => page.getByText(/Result series: \d+/).waitFor();

// Espera con tope a que una consulta de Prometheus dé el valor pedido.
const hastaQue = (expr, valor, tope = 420) =>
  `${LIB}; n=0; until [ "$(prom_consulta '${expr}')" = "${valor}" ]; do n=$((n + 3)); [ "$n" -lt ${tope} ] || exit 1; sleep 3; done`;

async function explorarMetricas(page, texto) {
  await page.getByRole('button', { name: 'Show query options' }).click();
  await page.getByRole('menuitem', { name: 'Explore metrics' }).click();
  await page.getByPlaceholder('Enter text to filter metric names by...').fill(texto);
  // La lista se filtra mientras se escribe, con coincidencia aproximada: se espera a que la
  // primera fila sea una métrica que contiene el texto.
  await page.waitForFunction((filtro) => {
    const primera = document.querySelector('[role="dialog"] tbody tr');
    return primera !== null && primera.textContent.includes(filtro);
  }, texto);
}

// Agrega un panel a la pestaña abierta, escribe la consulta y elige la visualización.
async function crearPanel(page, ayudas, { expr, visualizacion, descripcion, titulo, listo }) {
  await page.getByTestId('data-testid CanvasGridAddActions add-panel').click();
  await page.getByTestId('data-testid UnconfiguredPanel action-button configure').click();
  await page.getByTestId('data-testid radio-button-option code').click({ force: true });
  await page.locator('.monaco-editor textarea').first().waitFor({ state: 'attached' });
  await page.locator('.monaco-editor').first().click();
  await page.keyboard.type(expr);
  await page.locator('.monaco-editor').first().click();
  await ayudas.conConsulta(page, () => page.keyboard.press('Shift+Enter'));
  await page.getByRole('tab', { name: 'All visualizations' }).click();
  await page.getByTestId('data-testid Panel editor viz type picker search input').fill(visualizacion);
  await page.getByText(descripcion).click();
  await page.getByTestId('data-testid Panel editor option pane field input Title').fill(titulo);
  await listo(page);
}

const statListo = (page) =>
  page.waitForFunction(() => [...document.querySelectorAll('[data-testid*="Panel"] span, [data-viz-panel-key] span')]
    .some((e) => /^\d+$/.test(e.textContent.trim())));
const serieLista = (page) => page.locator('.u-over').first().waitFor();

export default [
  // --- Dejar todo como antes de empezar la práctica -------------------------------------
  { tipo: 'terminal', nota: 'config original', comando: `git checkout -- ${CONFIG} && docker exec gpe-prometheus kill -HUP 1` },
  {
    tipo: 'terminal',
    nota: 'borrar el dashboard y los datasources de una corrida anterior',
    comando: `${LIB}
      while uid="$(grafana_dashboard_existe "Primer vistazo")"; do grafana_api "/api/dashboards/uid/$uid" -X DELETE >/dev/null; done
      for uid in $(grafana_api /api/datasources | grep -o '"uid":"[^"]*"[^}]*"readOnly":false' | cut -d'"' -f4); do
        grafana_api "/api/datasources/uid/$uid" -X DELETE >/dev/null
      done`,
  },

  // --- Levantar el stack ----------------------------------------------------------------
  { tipo: 'terminal', comando: 'bin/up.sh', ultimas: 21, imagen: 1 },
  { tipo: 'terminal', comando: 'Capitulo2/preparar.sh' },
  { tipo: 'terminal', comando: 'bin/estado.sh', sale: 1, contiene: 'exited', imagen: 2 },

  // --- El destino caído -----------------------------------------------------------------
  {
    tipo: 'web',
    sitio: 'prometheus',
    url: '/targets',
    espera: (page) => page.getByText('1 / 2 up').waitFor(),
    imagen: 3,
  },
  {
    tipo: 'web',
    sitio: 'prometheus',
    url: consulta('up == 0'),
    espera: conResultado,
    recorte: { x: 0, y: 0, width: 1440, height: 380 },
    imagen: 4,
  },
  { tipo: 'terminal', comando: 'docker start gpe-catalogo-dev' },
  { tipo: 'terminal', nota: 'esperar a que Prometheus vuelva a verlo', comando: hastaQue('sum(up{job="catalogo"})', '2', 120) },
  {
    tipo: 'web',
    sitio: 'prometheus',
    url: consulta('up{job="catalogo"}'),
    espera: conResultado,
    recorte: { x: 0, y: 0, width: 1440, height: 420 },
    imagen: 5,
  },

  // --- Explorador de métricas -----------------------------------------------------------
  {
    tipo: 'web',
    sitio: 'prometheus',
    url: '/query',
    accion: (page) => explorarMetricas(page, 'node_memory_Mem'),
    recorte: { x: 0, y: 0, width: 1440, height: 480 },
    imagen: 6,
  },
  {
    tipo: 'web',
    sitio: 'prometheus',
    url: consulta('node_memory_MemAvailable_bytes'),
    espera: conResultado,
    recorte: { x: 0, y: 0, width: 1440, height: 340 },
    imagen: 7,
  },
  {
    tipo: 'web',
    sitio: 'prometheus',
    url: '/query',
    accion: (page) => explorarMetricas(page, 'node_cpu_seconds'),
    recorte: { x: 0, y: 0, width: 1440, height: 300 },
    imagen: 8,
  },
  {
    tipo: 'web',
    sitio: 'prometheus',
    url: consulta('sum by (mode) (rate(node_cpu_seconds_total[5m]))', 'g0.tab=graph&g0.range_input=30m'),
    espera: (page) => page.locator('.u-over').first().waitFor(),
    imagen: 9,
  },

  // --- Reetiquetado, promtool y recarga -------------------------------------------------
  // El error deliberado de la guía: a replacement le falta un espacio de sangría.
  {
    tipo: 'terminal',
    nota: 'editar con el error de sangría',
    comando: `sed 's/^        replacement: tienda/       replacement: tienda/' Capitulo2/solucion/prometheus.yml | grep -v -e 'Reetiquetado: a cada destino' -e 'Sin source_labels ni regex' > ${CONFIG}.nuevo && mv ${CONFIG}.nuevo ${CONFIG}`,
  },
  { tipo: 'terminal', comando: PROMTOOL, sale: 1, contiene: "yaml: line 99: did not find expected '-' indicator", imagen: 10 },
  {
    tipo: 'terminal',
    nota: 'corregir la sangría',
    comando: `sed 's/^       replacement: tienda/        replacement: tienda/' ${CONFIG} > ${CONFIG}.nuevo && mv ${CONFIG}.nuevo ${CONFIG}`,
  },
  { tipo: 'terminal', comando: PROMTOOL, contiene: 'SUCCESS', imagen: 11 },
  {
    tipo: 'web',
    sitio: 'prometheus',
    url: consulta('count by (equipo) (up{job="catalogo"})'),
    espera: conResultado,
    recorte: { x: 0, y: 0, width: 1440, height: 340 },
    imagen: 12,
  },
  { tipo: 'terminal', comando: 'docker exec gpe-prometheus kill -HUP 1' },
  { tipo: 'terminal', nota: 'esperar el primer scrape con la etiqueta', comando: hastaQue('count(count by (ambiente) (http_server_requests_total{job="catalogo", equipo="tienda"}))', '2', 120) },
  {
    tipo: 'web',
    sitio: 'prometheus',
    url: consulta('count by (equipo, ambiente) (http_server_requests_total{job="catalogo", equipo="tienda"})'),
    espera: conResultado,
    recorte: { x: 0, y: 0, width: 1440, height: 380 },
    imagen: 13,
  },

  // --- Grafana: datasources -------------------------------------------------------------
  {
    tipo: 'web',
    sitio: 'grafana',
    url: '/connections/datasources/edit/prometheus',
    espera: (page) => page.getByText('Provisioned data source').waitFor(),
    recorte: { x: 0, y: 0, width: 1440, height: 620 },
    imagen: 14,
  },
  {
    tipo: 'web',
    sitio: 'grafana',
    url: '/connections/datasources/new',
    accion: async (page) => {
      await page.getByRole('button', { name: /^Prometheus/ }).first().click();
      await page.locator('#connection-url').fill('http://prometheus:9090');
      await page.getByRole('button', { name: 'Save & test' }).click();
      const aviso = page.getByText('Successfully queried the Prometheus API');
      await aviso.waitFor();
      await page.getByText('Datasource added').waitFor({ state: 'hidden' });
      await aviso.evaluate((e) => e.scrollIntoView({ block: 'center' }));
    },
    imagen: 15,
  },
  {
    tipo: 'web',
    sitio: 'grafana',
    nota: 'borrar el datasource de práctica',
    accion: async (page) => {
      await page.getByRole('button', { name: 'Delete', exact: true }).click();
      await page.getByTestId('data-testid Confirm Modal Danger Button').click();
      await page.waitForURL((u) => u.pathname === '/connections/datasources');
    },
  },

  // --- Grafana: primer dashboard --------------------------------------------------------
  // En una clase pasan más de cinco minutos entre la recarga y este punto. Aquí se espera a
  // que caduquen las series anteriores a la recarga, para que sum(up) dé lo que ve el alumno.
  { tipo: 'terminal', nota: 'esperar a que caduquen las series anteriores a la recarga', comando: hastaQue('sum(up)', '12') },
  {
    tipo: 'web',
    sitio: 'grafana',
    nota: 'el camino del menú que nombra la guía existe',
    url: '/dashboards',
    accion: async (page) => {
      await page.getByTestId('data-testid CreateNewButton New button').click();
      await page.getByRole('menuitem', { name: 'New dashboard' }).waitFor();
      await page.keyboard.press('Escape');
    },
  },
  {
    tipo: 'web',
    sitio: 'grafana',
    url: '/dashboard/new',
    accion: async (page, ayudas) => {
      await page.getByRole('button', { name: 'Add tab' }).click();
      await page.getByTestId('data-testid tab title input').fill('Salud');
      await page.keyboard.press('Enter');
      await crearPanel(page, ayudas, {
        expr: 'sum(up)',
        visualizacion: 'Stat',
        descripcion: 'Big stat values',
        titulo: 'Destinos que responden',
        listo: statListo,
      });
    },
    imagen: 16,
  },
  {
    tipo: 'web',
    sitio: 'grafana',
    nota: 'pestaña Tráfico con su panel',
    accion: async (page, ayudas) => {
      await page.getByTestId('data-testid Back to dashboard button').click();
      await page.getByTestId('data-testid CanvasGridAddActions add-tab').click();
      await page.getByTestId('data-testid tab title input').fill('Tráfico');
      await page.keyboard.press('Enter');
      await crearPanel(page, ayudas, {
        expr: 'sum by (job) (rate(http_server_requests_total[5m]))',
        visualizacion: 'Time series',
        descripcion: 'Time based line',
        titulo: 'Peticiones por segundo',
        listo: serieLista,
      });
    },
    imagen: 17,
  },
  {
    tipo: 'web',
    sitio: 'grafana',
    nota: 'diálogo de guardado',
    accion: async (page) => {
      await page.getByTestId('data-testid Back to dashboard button').click();
      await page.getByTestId('data-testid Save dashboard button').click();
      const titulo = page.getByTestId('data-testid Save dashboard title field');
      await titulo.fill(TITULO);
      // El diálogo entra deslizándose. El clic de prueba espera a que deje de moverse.
      await page.getByRole('button', { name: 'Cancel' }).click({ trial: true });
    },
    imagen: 18,
  },
  {
    tipo: 'web',
    sitio: 'grafana',
    nota: 'dashboard guardado, pestaña Tráfico',
    accion: async (page) => {
      await page.getByRole('button', { name: 'Save', exact: true }).last().click();
      await page.waitForURL(/\/d\//);
      await page.getByText('Dashboard saved').waitFor({ state: 'hidden' });
      await serieLista(page);
    },
    imagen: 19,
  },
  // --- Verificación ---------------------------------------------------------------------
  { tipo: 'terminal', comando: 'Capitulo2/verificar.sh', imagen: 20 },

  // --- Resultado esperado -----------------------------------------------------------------
  {
    tipo: 'web',
    sitio: 'grafana',
    nota: 'dashboard guardado, pestaña Salud',
    accion: async (page) => {
      await page.getByTestId('data-testid Tab Salud').click();
      await statListo(page);
    },
    imagen: 21,
  },
];
