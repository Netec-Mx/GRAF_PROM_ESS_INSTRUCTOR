// Práctica 6. Dashboard dinámico para múltiples ambientes.
// Cada paso: tipo, sitio y url (o comando), espera, acción, recorte y número de imagen.
// Los pasos sin imagen hacen lo que el alumno hace a mano entre una captura y la siguiente.
//
// El dashboard se arma en un solo recorrido del navegador, sin recargar la página: mientras no
// se guarda, todo vive en la pestaña abierta.

const LIB = '. _comun/lib-practicas.sh';
const TITULO = 'Tianguis · Multiambiente';
const SERVICIOS = 'query_result(count by (job) (label_replace(http_server_request_duration_seconds_count, "ambiente", "prod", "ambiente", "") and on(ambiente) label_replace(vector(1), "ambiente", "$ambiente", "", "")))';
const TASA = 'sum(rate(http_server_request_duration_seconds_count{job="$servicio", ambiente=~"$ambiente|"}[$intervalo]))';
const P95 = 'histogram_quantile(0.95, sum by (le) (rate(http_server_request_duration_seconds_bucket{job="$servicio", ambiente=~"$ambiente|"}[$intervalo])))';
const ERRORES = '(sum by (job) (rate(http_server_requests_total{ambiente="$ambiente", status=~"5.."}[$intervalo])) / sum by (job) (rate(http_server_requests_total{ambiente="$ambiente"}[$intervalo]))) > $umbral';
const P95_PAGOS = 'histogram_quantile(0.95, sum by (le) (rate(http_server_request_duration_seconds_bucket{job="pagos", http_route="/pagos"}[$intervalo])))';
const ENLACE = '/explore?schemaVersion=1&panes={"a":{"datasource":"loki","queries":[{"refId":"A","expr":"{compose_service=~\\"${servicio}(-dev)?\\", ambiente=~\\"${ambiente}|\\"}"}],"range":{"from":"now-30m","to":"now"}}}';

const alto = (h) => ({ x: 0, y: 0, width: 1440, height: h });
const sinPuntero = (page) => page.mouse.move(720, 890);
// Cierra el menú de Grafana para que Explore tenga todo el ancho. abrirMenu lo devuelve.
async function cerrarMenu(page) {
  const boton = page.getByRole('button', { name: 'Close menu' });
  if (await boton.isVisible().catch(() => false)) await boton.click();
}
async function abrirMenu(page) {
  const boton = page.getByRole('button', { name: /Open menu|Dock menu/ }).first();
  if (await boton.isVisible().catch(() => false)) await boton.click();
}
const lateral = (page) => page.getByTestId('data-testid Sidebar container');

// --- Variables ---------------------------------------------------------------------------

// Abre el panel Add de la barra derecha, si no está abierto ya.
async function abrirAgregar(page) {
  const boton = page.getByTestId('data-testid sidebar add new variable button');
  const abierto = await boton.waitFor({ timeout: 4000 }).then(() => true, () => false);
  if (!abierto) await page.getByTestId('data-testid Dashboard Sidebar new button').click();
}

async function nuevaVariable(page, descripcion, nombre) {
  await abrirAgregar(page);
  await page.getByTestId('data-testid sidebar add new variable button').click();
  await page.getByText(descripcion).click({ force: true });
  await page.getByTestId('data-testid variable name input').fill(nombre);
  await page.getByTestId('data-testid variable name input').blur();
}

// Variable de consulta en modo Classic query. Deja abierto su editor con la vista previa.
async function variableDeConsulta(page, nombre, consulta, regex) {
  await nuevaVariable(page, 'Values are fetched from a data source query', nombre);
  await page.getByTestId('data-testid Query Variable editor open button').click();
  const dialogo = page.getByRole('dialog');
  await dialogo.getByTestId('data-testid query type-input').click({ force: true });
  await page.keyboard.type('Classic query');
  await page.keyboard.press('Enter');
  await dialogo.getByTestId('data-testid prometheus classic query').fill(consulta);
  await dialogo.getByTestId('data-testid prometheus classic query').blur();
  if (regex) {
    await dialogo.getByTestId('data-testid Variable editor Form Query RegEx field').fill(regex);
    await dialogo.getByTestId('data-testid Variable editor Form Query RegEx field').blur();
  }
  await dialogo.getByTestId('data-testid Query Variable editor preview button').click();
  await dialogo.getByText(/Preview of values \([1-9]/).waitFor();
}

const aplicarVariable = (page) => page.getByRole('dialog').getByTestId('data-testid Query Variable editor apply button').click();

async function interruptorDeSeleccion(page, nombre) {
  await page.getByTestId(`data-testid selection-options-category ${nombre} field property editor`).getByRole('switch').click({ force: true });
}

// --- Paneles -----------------------------------------------------------------------------

async function nuevaFila(page, titulo) {
  await abrirAgregar(page);
  await page.getByTestId('data-testid sidebar add new row button').click();
  await page.getByTestId('data-testid row title input').fill(titulo);
  await page.keyboard.press('Enter');
}

async function nuevoPanel(page) {
  await page.getByTestId('data-testid CanvasGridAddActions add-panel').last().click();
  await page.getByTestId('data-testid UnconfiguredPanel action-button configure').click();
}

// Escribe la consulta de la fila de consulta N (0 es A) y, si se pide, su leyenda propia.
async function consulta(page, ayudas, n, expr, leyenda) {
  if (n > 0) await page.getByRole('button', { name: 'Add query' }).click();
  const fila = page.getByTestId('data-testid Query editor row').nth(n);
  await fila.getByTestId('data-testid radio-button-option code').click({ force: true });
  await fila.locator('.monaco-editor textarea').first().waitFor({ state: 'attached' });
  await fila.locator('.monaco-editor').first().click();
  await page.keyboard.type(expr);
  if (leyenda) {
    await fila.getByText('Options', { exact: true }).first().click();
    await fila.getByTestId('data-testid prometheus legend wrapper').getByText('Auto', { exact: true }).click();
    await page.getByRole('option', { name: /Custom/ }).first().click();
    await fila.locator('#legendFormat').fill(leyenda);
    await ayudas.conConsulta(page, () => fila.locator('#legendFormat').blur());
  } else {
    await fila.locator('.monaco-editor').first().click();
    await ayudas.conConsulta(page, () => page.keyboard.press('Shift+Enter'));
  }
}

async function elegirVisualizacion(page, nombre) {
  await page.getByRole('tab', { name: 'All visualizations' }).click();
  await page.getByTestId('data-testid Panel editor viz type picker search input').fill(nombre);
  await page.getByTestId(`data-testid Plugin visualization item ${nombre}`).click();
}

const titular = (page, titulo) => page.getByTestId('data-testid Panel editor option pane field input Title').fill(titulo);
const volver = (page) => page.getByTestId('data-testid Back to dashboard button').click();

// Elige un valor en el selector de una variable, arriba del dashboard.
// En una variable de varios valores, primero se limpia lo elegido. El cambio se aplica al cerrar
// el selector con un clic afuera.
async function elegirValor(page, variable, valor) {
  const selector = page.getByTestId(`data-testid Dashboard template variables submenu Label ${variable}`).locator('..');
  const limpiar = selector.getByRole('button', { name: /Clear|clear/ });
  if (await limpiar.count()) await limpiar.first().click({ force: true });
  await selector.getByRole('combobox').first().click({ force: true });
  await page.getByRole('option', { name: valor, exact: true }).click();
  await page.mouse.click(720, 30);
}

// Recorre el gráfico de arriba abajo hasta que aparece el tooltip y lo deja fijo con un clic.
async function fijarTooltip(page, grafico) {
  const caja = await grafico.boundingBox();
  const x = caja.x + caja.width * 0.7;
  for (let f = 0.02; f < 1; f += 0.04) {
    await page.mouse.move(x, caja.y + caja.height * f, { steps: 3 });
    await page.waitForTimeout(150);
    if (await page.locator('[data-testid*="tooltip" i], [role="tooltip"]').count()) {
      await page.mouse.click(x, caja.y + caja.height * f);
      return;
    }
  }
  throw new Error('No apareció el tooltip del gráfico');
}

function explorar(panes) {
  return `/explore?schemaVersion=1&orgId=1&panes=${encodeURIComponent(JSON.stringify(panes))}`;
}

// trace_id del exemplar elegido. Lo usan los pasos de la correlación y del hallazgo.
let traceId = '';

const paneles = (page, n) => page.waitForFunction((total) =>
  [...document.querySelectorAll('h2')].filter((h) => /^Servicio [a-z]+$/.test(h.textContent.trim())).length === total, n);

export default [
  // --- Dejar todo como antes de empezar la práctica -------------------------------------
  {
    tipo: 'terminal',
    nota: 'borrar el dashboard y los archivos de una corrida anterior',
    comando: `${LIB}
      while uid="$(grafana_dashboard_existe "${TITULO}")"; do grafana_api "/api/dashboards/uid/$uid" -X DELETE >/dev/null; done
      rm -f Capitulo6/mi-dashboard.json
      git checkout -- Capitulo6/hallazgo.md`,
  },

  // --- Punto de partida -----------------------------------------------------------------
  { tipo: 'terminal', comando: 'Capitulo6/preparar.sh', imagen: 1 },
  // Pagos lentos de sobra para que el p95 y los exemplars los muestren.
  { tipo: 'terminal', nota: 'el p95 de pagos pasa de 1 segundo', comando: `${LIB}; n=0; until [ "$(prom_consulta 'histogram_quantile(0.95, sum by (le) (rate(http_server_request_duration_seconds_bucket{job="pagos", http_route="/pagos"}[5m]))) > 1')" != "" ]; do n=$((n + 3)); [ "$n" -lt 600 ] || exit 1; sleep 3; done` },

  // --- Paso 1. Variables ----------------------------------------------------------------
  {
    tipo: 'web',
    sitio: 'grafana',
    url: '/dashboard/new',
    nota: 'variable ambiente',
    accion: async (page) => {
      await variableDeConsulta(page, 'ambiente', 'label_values(http_server_requests_total, ambiente)');
    },
    imagen: 2,
  },
  {
    tipo: 'web',
    sitio: 'grafana',
    nota: 'variable servicio, dependiente de ambiente',
    accion: async (page) => {
      await aplicarVariable(page);
      await variableDeConsulta(page, 'servicio', SERVICIOS, '/job="([^"]+)"/');
    },
    imagen: 3,
  },
  {
    tipo: 'web',
    sitio: 'grafana',
    nota: 'variable intervalo',
    accion: async (page) => {
      await aplicarVariable(page);
      await interruptorDeSeleccion(page, 'Multi-value');
      await interruptorDeSeleccion(page, 'Include All value');
      await nuevaVariable(page, 'Values are timespans', 'intervalo');
      const valores = page.getByTestId('data-testid interval variable intervals input');
      await valores.fill('1m,5m,15m');
      await valores.blur();
      await page.getByTestId('data-testid interval variable auto value checkbox').uncheck({ force: true }).catch(() => {});
      await sinPuntero(page);
    },
    imagen: 4,
  },
  {
    tipo: 'web',
    sitio: 'grafana',
    nota: 'variable umbral',
    accion: async (page) => {
      await nuevaVariable(page, 'Values are static and defined manually', 'umbral');
      await page.getByTestId('data-testid custom-variable-options-open-button').click();
      const dialogo = page.getByRole('dialog');
      const campo = dialogo.locator('textarea, input[type="text"]').first();
      await campo.fill('0.01,0.05,0.10');
      await campo.blur();
      await dialogo.getByText(/0\.05/).last().waitFor();
    },
    imagen: 5,
  },
  {
    tipo: 'web',
    sitio: 'grafana',
    nota: 'filtro ad hoc',
    accion: async (page) => {
      await page.getByRole('dialog').getByRole('button', { name: /Apply|Save|Close/ }).last().click();
      await abrirAgregar(page);
      await page.getByRole('button', { name: 'Filter and Group by' }).click();
      const nombre = page.getByTestId('data-testid variable name input');
      await nombre.fill('filtros');
      await nombre.blur();
      await lateral(page).getByTestId('data-testid Select a data source').click({ force: true });
      await page.keyboard.type('Prometheus');
      await page.keyboard.press('Enter');
      await lateral(page).getByTestId('data-testid Select a data source').waitFor();
      await sinPuntero(page);
    },
    imagen: 6,
  },

  // --- Paso 2. Panel repetido por servicio ----------------------------------------------
  {
    tipo: 'web',
    sitio: 'grafana',
    nota: 'fila Servicios, tasa y p95',
    accion: async (page, ayudas) => {
      await elegirValor(page, 'ambiente', 'prod');
      await nuevaFila(page, 'Servicios');
      await nuevoPanel(page);
      await consulta(page, ayudas, 0, TASA, 'peticiones por segundo');
      await consulta(page, ayudas, 1, P95, 'p95 en segundos');
      await elegirVisualizacion(page, 'Time series');
      await titular(page, 'Servicio $servicio');
      await sinPuntero(page);
    },
    imagen: 7,
  },
  {
    tipo: 'web',
    sitio: 'grafana',
    nota: 'repetir por servicio',
    accion: async (page) => {
      await page.getByText('Repeat options', { exact: true }).click();
      await page.getByTestId('data-testid repeat-options Repeat by variable field property editor').click();
      await page.getByRole('option', { name: 'servicio' }).click();
      await page.getByTestId('data-testid repeat-options Repeat by variable field property editor').scrollIntoViewIfNeeded();
      await sinPuntero(page);
    },
    imagen: 8,
  },

  // --- Paso 4. Enlace de datos hacia Explore --------------------------------------------
  {
    tipo: 'web',
    sitio: 'grafana',
    nota: 'enlace de datos',
    accion: async (page) => {
      await page.getByText('Data links and actions', { exact: true }).scrollIntoViewIfNeeded();
      await page.getByRole('button', { name: /Add link/ }).first().click();
      const dialogo = page.getByRole('dialog');
      // Título y URL son editores de texto con sugerencias de variables, no campos comunes.
      await dialogo.locator('[contenteditable="true"]').nth(0).click();
      await page.keyboard.insertText('Logs de ${servicio} en Explore');
      await dialogo.locator('[contenteditable="true"]').nth(1).click();
      await page.keyboard.insertText(ENLACE);
      await dialogo.getByText('Open in new tab').click();
      await sinPuntero(page);
    },
    imagen: 9,
  },
  {
    tipo: 'web',
    sitio: 'grafana',
    nota: 'fila con la proporción de errores sobre el umbral',
    accion: async (page, ayudas) => {
      await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
      await volver(page);
      await nuevaFila(page, 'Errores sobre el umbral');
      await nuevoPanel(page);
      await consulta(page, ayudas, 0, ERRORES);
      await elegirVisualizacion(page, 'Time series');
      await titular(page, 'Servicios con más errores que el umbral');
      await sinPuntero(page);
    },
    imagen: 10,
  },

  // --- Paso 3. Sección condicional y exemplars de pagos ---------------------------------
  {
    tipo: 'web',
    sitio: 'grafana',
    nota: 'fila de pagos con exemplars',
    accion: async (page, ayudas) => {
      await volver(page);
      await nuevaFila(page, 'Pagos y su pasarela');
      await nuevoPanel(page);
      await consulta(page, ayudas, 0, P95_PAGOS, 'p95 de pagos');
      const fila = page.getByTestId('data-testid Query editor row').first();
      await ayudas.conConsulta(page, () => fila.getByTestId('data-testid prometheus-exemplars').click({ force: true }));
      // El interruptor de exemplars vuelve a correr la consulta y deja la leyenda en Auto.
      if ((await fila.locator('#legendFormat').inputValue().catch(() => '')) !== 'p95 de pagos') {
        await fila.getByTestId('data-testid prometheus legend wrapper').getByText('Auto', { exact: true }).click();
        await page.getByRole('option', { name: /Custom/ }).first().click();
        await fila.locator('#legendFormat').fill('p95 de pagos');
        await ayudas.conConsulta(page, () => fila.locator('#legendFormat').blur());
      }
      await elegirVisualizacion(page, 'Time series');
      await titular(page, 'p95 de pagos con exemplars');
      await page.getByTestId('data-testid Exemplar marker').first().waitFor();
      await sinPuntero(page);
    },
    imagen: 11,
  },
  {
    tipo: 'web',
    sitio: 'grafana',
    nota: 'regla para mostrar la fila solo en prod',
    accion: async (page) => {
      await volver(page);
      await page.getByTestId('data-testid dashboard-row-title-Pagos y su pasarela').click();
      // La barra lateral no se desplaza sola hasta las reglas. Con una ventana alta queda a la vista.
      await page.setViewportSize({ width: 1440, height: 1500 });
      const grupo = page.getByTestId('data-testid Options group conditional-rendering-options');
      await grupo.getByTestId('data-testid Value picker button Add rule').click();
      await page.getByText('Template variable', { exact: true }).click();
      await grupo.getByTestId('data-testid Dashboard Conditional Rendering Variable variable selection').click({ force: true });
      await page.getByRole('option', { name: 'ambiente' }).click();
      await grupo.getByTestId('data-testid Dashboard Conditional Rendering Variable value input').fill('prod');
      await grupo.getByTestId('data-testid Dashboard Conditional Rendering Variable value input').blur();
      await sinPuntero(page);
    },
    recorte: '[data-testid="data-testid Options group conditional-rendering-options"]',
    imagen: 12,
  },
  {
    tipo: 'web',
    sitio: 'grafana',
    nota: 'guardar el dashboard',
    accion: async (page) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.getByTestId('data-testid Save dashboard button').click();
      await page.getByTestId('data-testid Save dashboard title field').fill(TITULO);
      // El panel de guardado entra deslizándose. El clic de prueba espera a que deje de moverse.
      await page.getByRole('button', { name: 'Cancel' }).click({ trial: true });
      await page.getByRole('button', { name: 'Save', exact: true }).last().click();
      await page.waitForURL(/\/d\//);
      await page.getByText('Dashboard saved').waitFor({ state: 'hidden' });
      await page.getByRole('button', { name: 'Exit edit' }).click().catch(() => {});
    },
  },
  {
    tipo: 'web',
    sitio: 'grafana',
    nota: 'prod con todos los servicios',
    accion: async (page) => {
      await elegirValor(page, 'servicio', 'All');
      await paneles(page, 3);
      await sinPuntero(page);
    },
    imagen: 13,
  },
  {
    tipo: 'web',
    sitio: 'grafana',
    nota: 'dev, sin pagos',
    accion: async (page) => {
      await elegirValor(page, 'ambiente', 'dev');
      await paneles(page, 2);
      await page.getByTestId('data-testid dashboard-row-title-Pagos y su pasarela').waitFor({ state: 'detached' });
      await sinPuntero(page);
    },
    imagen: 14,
  },
  {
    tipo: 'web',
    sitio: 'grafana',
    nota: 'enlace de datos de catalogo',
    accion: async (page, ayudas) => {
      const uid = ayudas.correr(`${LIB}; grafana_dashboard_existe "${TITULO}"`).salida.trim();
      await page.goto(ayudas.urlDe('grafana', `/d/${uid}?var-ambiente=prod&var-servicio=All`));
      await paneles(page, 3);
      const grafico = page.locator('[data-viz-panel-key]').filter({ hasText: 'Servicio catalogo' }).locator('.u-over').first();
      await fijarTooltip(page, grafico);
      await page.getByText('Logs de catalogo en Explore').first().waitFor();
    },
    imagen: 15,
  },
  {
    tipo: 'web',
    sitio: 'grafana',
    nota: 'Explore con los logs de catalogo',
    accion: async (page, ayudas) => {
      const pestana = page.context().waitForEvent('page');
      await page.getByText('Logs de catalogo en Explore').first().click();
      const explore = await pestana;
      await explore.waitForLoadState();
      await explore.getByText('compose_service').first().waitFor();
      const destino = new URL(explore.url());
      await page.goto(ayudas.urlDe('grafana', destino.pathname + destino.search));
      await explore.close();
      await page.locator('[data-testid="logRows"], [data-testid="log-line"]').first().waitFor().catch(() => {});
      await page.getByText('Logs volume').first().waitFor();
    },
    imagen: 16,
  },

  // --- Paso 5. Explore lado a lado ------------------------------------------------------
  {
    tipo: 'web',
    sitio: 'grafana',
    url: explorar({
      a: { datasource: 'prometheus', queries: [{ refId: 'A', expr: 'sum(rate(http_server_request_duration_seconds_count{job="pagos", http_route="/pagos"}[1m]))', range: true, datasource: { type: 'prometheus', uid: 'prometheus' } }], range: { from: 'now-30m', to: 'now' } },
      b: { datasource: 'loki', queries: [{ refId: 'A', expr: 'sum(rate({compose_service="pagos"} | json | msg="pago procesado" [1m]))', queryType: 'range', datasource: { type: 'loki', uid: 'loki' } }], range: { from: 'now-30m', to: 'now' } },
    }),
    nota: 'Prometheus y Loki lado a lado',
    espera: async (page) => {
      await page.waitForFunction(() => document.querySelectorAll('.u-over').length >= 2);
      await cerrarMenu(page);
      // Los paneles se vuelven a dibujar con el ancho nuevo.
      await page.waitForFunction(() => [...document.querySelectorAll('.u-over')].every((e) => e.getBoundingClientRect().width > 380));
    },
    imagen: 17,
  },

  // --- Paso 6. Drilldown ----------------------------------------------------------------
  {
    tipo: 'web',
    sitio: 'grafana',
    url: '/a/grafana-metricsdrilldown-app/drilldown',
    nota: 'Metrics Drilldown',
    accion: async (page) => {
      await abrirMenu(page);
      const buscar = page.getByPlaceholder(/Search metric/i).first();
      await buscar.fill('payments');
      await page.getByText('payments_processed_total').first().waitFor();
      await page.waitForFunction(() => document.querySelectorAll('.u-over').length >= 1);
      await sinPuntero(page);
    },
    imagen: 18,
  },
  {
    tipo: 'web',
    sitio: 'grafana',
    url: '/a/grafana-lokiexplore-app/explore',
    nota: 'Logs Drilldown',
    accion: async (page) => {
      await page.getByPlaceholder(/Search/i).first().fill('pagos');
      await page.getByRole('option', { name: 'gpe-pagos' }).click();
      await page.getByText(/Log volume/).first().waitFor();
      await page.getByText('Welcome to Grafana Logs Drilldown!').locator('../..').getByRole('button').last().click().catch(() => {});
      await page.waitForFunction(() => document.querySelectorAll('.u-over').length >= 1);
      await sinPuntero(page);
    },
    imagen: 19,
  },
  {
    tipo: 'web',
    sitio: 'grafana',
    url: '/a/grafana-exploretraces-app/explore',
    nota: 'Traces Drilldown',
    accion: async (page) => {
      await page.getByText('pagos').first().waitFor();
      await page.waitForFunction(() => document.querySelectorAll('.u-over').length >= 1);
      await sinPuntero(page);
    },
    imagen: 20,
  },

  // --- Paso 7. Correlación desde un exemplar --------------------------------------------
  {
    tipo: 'web',
    sitio: 'grafana',
    nota: 'exemplar de un pago lento',
    accion: async (page, ayudas) => {
      const uid = ayudas.correr(`${LIB}; grafana_dashboard_existe "${TITULO}"`).salida.trim();
      await page.goto(ayudas.urlDe('grafana', `/d/${uid}?var-ambiente=prod&var-servicio=All&from=now-15m&to=now`));
      const fila = page.getByTestId('data-testid dashboard-row-title-Pagos y su pasarela');
      await fila.evaluate((e) => e.scrollIntoView({ block: 'start' }));
      const marcas = page.getByTestId('data-testid Exemplar marker');
      await marcas.first().waitFor();
      // El exemplar más alto del gráfico es el pago más lento.
      let elegido = 0;
      let arriba = Infinity;
      const total = await marcas.count();
      for (let i = 0; i < total; i += 1) {
        const caja = await marcas.nth(i).boundingBox();
        if (caja && caja.y < arriba) { arriba = caja.y; elegido = i; }
      }
      await marcas.nth(elegido).hover();
      await page.getByText('Ver traza').waitFor();
      traceId = (await page.getByText(/^[0-9a-f]{32}$/).first().innerText()).trim();
      if (!traceId) throw new Error('No encontré el trace_id en el tooltip del exemplar');
    },
    imagen: 21,
  },
  {
    tipo: 'web',
    sitio: 'grafana',
    nota: 'la traza en Tempo',
    accion: async (page, ayudas) => {
      await page.getByText('Ver traza').click();
      await page.waitForURL(/\/explore/);
      await page.goto(ayudas.urlDe('grafana', new URL(page.url()).pathname + new URL(page.url()).search));
      await page.getByText('pasarela.cobrar').first().waitFor();
      await cerrarMenu(page);
      await page.getByText('pasarela.cobrar').first().click();
      await page.getByRole('button', { name: /Logs for this/ }).first().waitFor();
      await sinPuntero(page);
    },
    imagen: 22,
  },
  {
    tipo: 'web',
    sitio: 'grafana',
    nota: 'los logs de la traza en Loki',
    accion: async (page, ayudas) => {
      await page.getByRole('button', { name: /Logs for this/ }).first().click();
      await page.waitForURL(/panes=.*loki/);
      await page.goto(ayudas.urlDe('grafana', new URL(page.url()).pathname + new URL(page.url()).search));
      await cerrarMenu(page);
      await page.getByText('pasarela.cobrar').first().click();
      await page.getByText(/lines displayed|lines shown/).first().waitFor();
      await sinPuntero(page);
    },
    imagen: 23,
  },
  {
    tipo: 'web',
    sitio: 'grafana',
    nota: 'el alumno anota el trace_id en hallazgo.md',
    accion: async (page, ayudas) => {
      const r = ayudas.correr(`printf '%s\\n' '${traceId}' >> Capitulo6/hallazgo.md`);
      if (r.codigo !== 0) throw new Error(r.salida);
    },
  },
  { tipo: 'terminal', comando: 'cat Capitulo6/hallazgo.md', imagen: 24 },

  // --- Paso 8. Exportar ------------------------------------------------------------------
  {
    tipo: 'web',
    sitio: 'grafana',
    nota: 'exportar el dashboard',
    accion: async (page, ayudas) => {
      await abrirMenu(page);
      const uid = ayudas.correr(`${LIB}; grafana_dashboard_existe "${TITULO}"`).salida.trim();
      await page.goto(ayudas.urlDe('grafana', `/d/${uid}?var-ambiente=prod&var-servicio=All`));
      await page.getByRole('button', { name: /^Export/ }).click();
      await page.getByRole('menuitem', { name: /Export as code/ }).click();
      await page.getByRole('button', { name: /Download file/ }).click({ trial: true });
    },
    imagen: 25,
  },
  {
    tipo: 'web',
    sitio: 'grafana',
    nota: 'guardar el archivo en Capitulo6/mi-dashboard.json',
    accion: async (page, ayudas) => {
      const descarga = page.waitForEvent('download');
      await page.getByRole('button', { name: /Download file/ }).click();
      await (await descarga).saveAs(ayudas.rutaDelRepo('Capitulo6/mi-dashboard.json'));
    },
  },

  // --- Todo de vuelta a la normalidad ---------------------------------------------------
  { tipo: 'terminal', comando: 'bin/trafico.sh nivel normal', imagen: 26 },
  { tipo: 'terminal', comando: 'bin/caos.sh apagar', imagen: 27, ultimas: 3 },
  // pagos informa sus fallas por OTLP cada 15 segundos. Prometheus tarda eso en verlas apagadas.
  { tipo: 'terminal', nota: 'Prometheus ve las fallas apagadas', comando: `${LIB}; n=0; until prom_existe 'sum(chaos_active) == 0'; do n=$((n + 3)); [ "$n" -lt 120 ] || exit 1; sleep 3; done` },

  // --- Verificación ---------------------------------------------------------------------
  { tipo: 'terminal', comando: 'Capitulo6/verificar.sh', imagen: 28 },

  // --- Resultado esperado ---------------------------------------------------------------
  {
    tipo: 'web',
    sitio: 'grafana',
    nota: 'dashboard completo en una ventana alta',
    accion: async (page, ayudas) => {
      const uid = ayudas.correr(`${LIB}; grafana_dashboard_existe "${TITULO}"`).salida.trim();
      await page.setViewportSize({ width: 1440, height: 1900 });
      await page.goto(ayudas.urlDe('grafana', `/d/${uid}?var-ambiente=prod&var-servicio=All`));
      await paneles(page, 3);
      await page.getByTestId('data-testid Exemplar marker').first().waitFor();
      await sinPuntero(page);
    },
    imagen: 29,
  },
  {
    tipo: 'web',
    sitio: 'grafana',
    nota: 'ventana normal otra vez',
    accion: (page) => page.setViewportSize({ width: 1440, height: 900 }),
  },
];
