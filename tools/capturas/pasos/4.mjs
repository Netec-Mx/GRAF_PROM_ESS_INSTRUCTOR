// Práctica 4. Dashboard de aplicación web basado en el método RED.
// Cada paso: tipo, sitio y url (o comando), espera, acción, recorte y número de imagen.
// Los pasos sin imagen hacen lo que el alumno hace a mano entre una captura y la siguiente.
//
// El dashboard se arma en un solo recorrido del navegador, sin recargar la página: mientras no
// se guarda, todo vive en la pestaña abierta.

const LIB = '. _comun/lib-practicas.sh';
const TITULO = 'Tianguis · RED';

// --- Editor de paneles --------------------------------------------------------------------

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

async function titular(page, titulo) {
  await page.getByTestId('data-testid Panel editor option pane field input Title').fill(titulo);
}

// Un campo de opciones del panel, buscado por su etiqueta dentro de su grupo.
const campo = (page, grupo, etiqueta) => page.getByTestId(`data-testid ${grupo} ${etiqueta} field property editor`);

async function unidad(page, texto) {
  const selector = page.getByTestId('data-testid UnitPicker container').locator('input');
  await selector.click();
  await page.keyboard.type(texto);
  // La primera opción es la unidad con su categoría. La de abajo crearía una unidad nueva.
  await page.getByRole('option').first().getByText(` / ${texto}`).waitFor();
  await page.keyboard.press('Enter');
}

// Agrega un panel al final de la fila abierta y entra a su editor.
async function nuevoPanel(page) {
  await page.getByTestId('data-testid CanvasGridAddActions add-panel').last().click();
  await page.getByTestId('data-testid UnconfiguredPanel action-button configure').click();
}

async function volver(page) {
  await page.getByTestId('data-testid Back to dashboard button').click();
}

async function nuevaFila(page, titulo, primera) {
  if (primera) {
    await page.getByTestId('data-testid sidebar add new row button').click();
  } else {
    await page.getByTestId('data-testid CanvasGridAddActions add-row').last().click();
  }
  const campoTitulo = page.getByTestId('data-testid row title input');
  await campoTitulo.fill(titulo);
  await page.keyboard.press('Enter');
}

// Umbrales del Gauge. "Add threshold" agrega uno amarillo con valor 90 y el rojo viene en 80.
async function umbral(page) {
  const umbrales = page.getByTestId('data-testid Thresholds Thresholds field property editor');
  await umbrales.getByRole('button', { name: 'Add threshold' }).click();
  await umbrales.getByLabel('Threshold 2', { exact: true }).fill('0.05');
  await umbrales.getByLabel('Threshold 2', { exact: true }).blur();
  await umbrales.getByLabel('Threshold 1', { exact: true }).fill('0.01');
  await umbrales.getByLabel('Threshold 1', { exact: true }).blur();
}

async function elegirFuente(page, nombre) {
  const selector = page.getByTestId('data-testid Select a data source');
  await selector.click();
  await page.keyboard.type(nombre);
  await page.keyboard.press('Enter');
  await page.getByTestId(`data-testid Query editor row ${nombre.toLowerCase()} A`).waitFor();
}

// Abre las opciones de la consulta de Prometheus, si están cerradas.
async function opcionesDeConsulta(page) {
  if (!(await page.getByLabel('Format combobox').isVisible())) {
    await page.getByText('Options', { exact: true }).click();
  }
}

async function formato(page, ayudas, nombre) {
  await opcionesDeConsulta(page);
  await page.getByTestId('data-testid prometheus format').click();
  await page.keyboard.type(nombre);
  await ayudas.conConsulta(page, () => page.keyboard.press('Enter'));
}

const TEXTO_RED = [
  '## Método RED',
  '',
  'Tres preguntas para cada servicio que atiende peticiones.',
  '',
  '**Rate**, cuántas peticiones por segundo atiende.',
  '',
  '**Errors**, qué proporción de esas peticiones falla.',
  '',
  '**Duration**, cuánto tardan, medido con el percentil 95.',
];

// Agrega una transformación y la configura dentro de su editor.
async function transformar(page, nombre, configurar) {
  await page.getByTestId('data-testid Tab Transformations').click();
  await page.getByTestId('data-testid add transformation button').click();
  await page.getByTestId('data-testid search transformations').fill(nombre);
  await page.getByTestId(`data-testid New transform ${nombre}`).click();
  await configurar(page.getByTestId(`data-testid Transformation editor ${nombre}`));
}

// Deja un interruptor de las opciones del panel encendido o apagado.
async function interruptor(page, etiqueta, encendido) {
  const control = page.getByLabel(etiqueta, { exact: true });
  if ((await control.isChecked()) !== encendido) await control.click({ force: true });
}

// Saca el puntero de encima de los botones, para que no aparezcan sus ayudas en la foto.
const sinPuntero = (page) => page.mouse.move(720, 890);

// Relative time o Time shift, en Query options.
async function opcionDeTiempo(page, ayudas, id, valor) {
  if (!(await page.locator(id).isVisible())) {
    await page.getByText('Query options', { exact: true }).click();
  }
  await page.locator(id).fill(valor);
  await ayudas.conConsulta(page, () => page.locator(id).blur());
}

const valorGrande = (page) =>
  page.waitForFunction(() => [...document.querySelectorAll('[data-testid="data-testid panel content"] span, [data-testid="data-testid panel content"] div')]
    .some((e) => e.children.length === 0 && /\d/.test(e.textContent)));

export default [
  // --- Dejar todo como antes de empezar la práctica -------------------------------------
  {
    tipo: 'terminal',
    nota: 'borrar el dashboard de una corrida anterior',
    comando: `${LIB}
      while uid="$(grafana_dashboard_existe "${TITULO}")"; do grafana_api "/api/dashboards/uid/$uid" -X DELETE >/dev/null; done
      rm -f Capitulo4/mi-dashboard.json`,
  },

  // --- Punto de partida -----------------------------------------------------------------
  { tipo: 'terminal', comando: 'Capitulo4/preparar.sh', imagen: 1 },

  // --- Paso 1. Dashboards sugeridos -----------------------------------------------------
  {
    tipo: 'web',
    sitio: 'grafana',
    url: '/connections/datasources/edit/prometheus',
    accion: async (page) => {
      await page.getByRole('button', { name: 'Build a dashboard' }).click();
      await page.getByRole('menuitem', { name: 'From suggestions' }).waitFor();
    },
    recorte: { x: 0, y: 0, width: 1440, height: 420 },
    imagen: 2,
  },
  {
    tipo: 'web',
    sitio: 'grafana',
    nota: 'lista de sugeridos',
    accion: async (page) => {
      await page.getByRole('menuitem', { name: 'From suggestions' }).click();
      const dialogo = page.getByRole('dialog');
      await dialogo.getByText('Node Exporter Full').first().waitFor();
      await dialogo.locator('img').first().waitFor();
      await page.waitForFunction(() => [...document.querySelectorAll('[role="dialog"] img')].every((i) => i.complete));
    },
    imagen: 3,
  },
  {
    tipo: 'web',
    sitio: 'grafana',
    nota: 'Node Exporter Full sin guardar',
    accion: async (page) => {
      await page.getByRole('dialog').getByRole('article').filter({ hasText: 'Node Exporter Full' })
        .getByRole('button', { name: 'View dashboard' }).click();
      await page.waitForURL(/\/dashboard\/template/);
      await page.getByText('You are viewing Node Exporter Full').waitFor();
    },
    imagen: 4,
  },
  {
    tipo: 'web',
    sitio: 'grafana',
    nota: 'descartarlo',
    accion: async (page) => {
      await page.getByTestId('data-testid Nav menu item').filter({ hasText: 'Dashboards' }).first().click();
      const descartar = page.getByRole('button', { name: 'Discard' });
      if (await descartar.isVisible().catch(() => false)) await descartar.click();
      await page.waitForURL((u) => u.pathname === '/dashboards');
    },
  },

  // --- Paso 2. El dashboard RED, fila Ahora ---------------------------------------------
  {
    tipo: 'web',
    sitio: 'grafana',
    url: '/dashboard/new',
    nota: 'fila Ahora y Stat',
    accion: async (page, ayudas) => {
      await nuevaFila(page, 'Ahora', true);
      await nuevoPanel(page);
      await escribirConsulta(page, ayudas, 'sum(rate(http_server_requests_total{ambiente="prod"}[5m]))');
      await elegirVisualizacion(page, 'Stat');
      await titular(page, 'Peticiones por segundo en prod');
      await unidad(page, 'requests/sec (rps)');
      await valorGrande(page);
    },
    imagen: 5,
  },
  {
    tipo: 'web',
    sitio: 'grafana',
    nota: 'Bar gauge con el p95',
    accion: async (page, ayudas) => {
      await volver(page);
      await nuevoPanel(page);
      await escribirConsulta(page, ayudas,
        'histogram_quantile(0.95, sum by (job, le) (rate(http_server_request_duration_seconds_bucket{ambiente!="dev", http_route!="/salud"}[5m])))');
      await elegirVisualizacion(page, 'Bar gauge');
      await titular(page, 'p95 por servicio en prod');
      await unidad(page, 'seconds (s)');
    },
    imagen: 6,
  },
  {
    tipo: 'web',
    sitio: 'grafana',
    nota: 'Gauge de errores',
    accion: async (page, ayudas) => {
      await volver(page);
      await nuevoPanel(page);
      await escribirConsulta(page, ayudas,
        'sum(rate(http_server_requests_total{ambiente="prod", status=~"5.."}[5m])) / sum(rate(http_server_requests_total{ambiente="prod"}[5m]))');
      await elegirVisualizacion(page, 'Gauge');
      await titular(page, 'Proporción de errores en prod');
      await unidad(page, 'Percent (0.0-1.0)');
      await umbral(page);
    },
    imagen: 7,
  },

  // --- Paso 4. Logs de Loki al lado del Gauge -------------------------------------------
  {
    tipo: 'web',
    sitio: 'grafana',
    nota: 'logs de Loki al lado del Gauge',
    accion: async (page, ayudas) => {
      await volver(page);
      await nuevoPanel(page);
      await elegirFuente(page, 'Loki');
      await escribirConsulta(page, ayudas, '{compose_service="catalogo"} | json | level="error"');
      await elegirVisualizacion(page, 'Logs');
      await titular(page, 'Errores de catalogo');
      await page.getByText(/^\s*error\s*$/i).first().waitFor();
    },
    imagen: 8,
  },
  {
    tipo: 'web',
    sitio: 'grafana',
    nota: 'fila Ahora completa',
    accion: async (page) => {
      await volver(page);
      await sinPuntero(page);
    },
    imagen: 9,
  },

  // --- Paso 2 y 3. Fila Tendencia -------------------------------------------------------
  {
    tipo: 'web',
    sitio: 'grafana',
    nota: 'fila Tendencia y Time series',
    accion: async (page, ayudas) => {
      await nuevaFila(page, 'Tendencia');
      await nuevoPanel(page);
      await escribirConsulta(page, ayudas, 'sum by (job, ambiente) (rate(http_server_requests_total[5m]))');
      await elegirVisualizacion(page, 'Time series');
      await titular(page, 'Peticiones por segundo por job y ambiente');
      await unidad(page, 'requests/sec (rps)');
    },
    imagen: 10,
  },
  {
    tipo: 'web',
    sitio: 'grafana',
    nota: 'la misma una hora antes',
    accion: async (page, ayudas) => {
      await volver(page);
      await nuevoPanel(page);
      await escribirConsulta(page, ayudas, 'sum by (job, ambiente) (rate(http_server_requests_total[5m]))');
      await elegirVisualizacion(page, 'Time series');
      await titular(page, 'La misma, una hora antes');
      await unidad(page, 'requests/sec (rps)');
      await opcionDeTiempo(page, ayudas, '#time-shift-input', '1h');
    },
    imagen: 11,
    // Solo Query options. El gráfico desplazado respondería la predicción del paso 23.
    recorte: { x: 320, y: 560, width: 790, height: 270 },
  },
  {
    tipo: 'terminal',
    nota: 'catalogo ya tiene errores en el último minuto',
    comando: `${LIB}; esperar_hasta 180 "errores de catalogo en Prometheus" prom_existe 'rate(http_server_requests_total{job="catalogo", status=~"5.."}[1m]) > 0'`,
  },
  {
    tipo: 'web',
    sitio: 'grafana',
    nota: 'tiempo relativo propio',
    accion: async (page, ayudas) => {
      await volver(page);
      await nuevoPanel(page);
      await escribirConsulta(page, ayudas, 'sum by (job) (rate(http_server_requests_total{status=~"5.."}[1m]))');
      await elegirVisualizacion(page, 'Time series');
      await titular(page, 'Errores por segundo, últimos 5 minutos');
      await unidad(page, 'requests/sec (rps)');
      await opcionDeTiempo(page, ayudas, '#relative-time-input', '5m');
    },
    imagen: 12,
  },
  {
    tipo: 'web',
    sitio: 'grafana',
    nota: 'Heatmap de pedidos',
    accion: async (page, ayudas) => {
      await volver(page);
      await nuevoPanel(page);
      await escribirConsulta(page, ayudas,
        'sum by (le) (rate(http_server_request_duration_seconds_bucket{job="pedidos", ambiente="prod"}[5m]))');
      await formato(page, ayudas, 'Heatmap');
      await elegirVisualizacion(page, 'Heatmap');
      await titular(page, 'Duración de pedidos en prod');
    },
    imagen: 13,
  },

  // --- Paso 2. Fila Referencia ----------------------------------------------------------
  {
    tipo: 'web',
    sitio: 'grafana',
    nota: 'fila Referencia y Table',
    accion: async (page, ayudas) => {
      await volver(page);
      await nuevaFila(page, 'Referencia');
      await nuevoPanel(page);
      await escribirConsulta(page, ayudas,
        'topk(10, sum by (job, route) (rate(http_server_requests_total{ambiente="prod"}[5m])))');
      await formato(page, ayudas, 'Table');
      await page.getByTestId('data-testid radio-button-option instant').click({ force: true });
      await ayudas.conConsulta(page, () => page.getByRole('button', { name: 'Run queries' }).click());
      await elegirVisualizacion(page, 'Table');
      await titular(page, 'Rutas más llamadas en prod');
      await transformar(page, 'Sort by', async (editor) => {
        await editor.getByTestId('data-testid Select container-input').click();
        await page.keyboard.type('Value');
        await page.keyboard.press('Enter');
        await editor.getByRole('switch').click({ force: true });
      });
      await transformar(page, 'Organize fields by name', async (editor) => {
        await editor.locator('[data-rfd-draggable-id="Time"] button[aria-label="Disable"]').click();
        await editor.getByPlaceholder('Rename Value').fill('Por segundo');
        await editor.getByPlaceholder('Rename Value').blur();
      });
      await page.getByRole('columnheader', { name: /Por segundo/ }).waitFor();
      await sinPuntero(page);
    },
    imagen: 14,
  },
  {
    tipo: 'web',
    sitio: 'grafana',
    nota: 'Text con el método RED',
    accion: async (page) => {
      await volver(page);
      await nuevoPanel(page);
      await elegirVisualizacion(page, 'Text');
      await titular(page, 'El método RED');
      const editor = campo(page, 'Text', 'Content').locator('.monaco-editor[role="code"]');
      await editor.click();
      await page.keyboard.press('ControlOrMeta+A');
      await page.keyboard.press('Delete');
      for (const linea of TEXTO_RED) {
        await page.keyboard.type(linea);
        await page.keyboard.press('Enter');
      }
      // El contenido se aplica al salir del editor.
      await page.getByText('Mode', { exact: true }).click();
      await page.getByTestId('data-testid panel content').getByText('Rate').first().waitFor();
      await sinPuntero(page);
    },
    imagen: 15,
  },
  {
    tipo: 'web',
    sitio: 'grafana',
    nota: 'Dashboard list',
    accion: async (page) => {
      await volver(page);
      await nuevoPanel(page);
      await elegirVisualizacion(page, 'Dashboard list');
      await titular(page, 'Dashboards del curso');
      await interruptor(page, 'Starred', false);
      await interruptor(page, 'Search', true);
      await page.getByLabel('Query', { exact: true }).fill('Tianguis');
      await page.getByLabel('Query', { exact: true }).blur();
      await sinPuntero(page);
    },
    imagen: 16,
  },

  // --- Paso 5. Ordenar y guardar --------------------------------------------------------
  {
    tipo: 'web',
    sitio: 'grafana',
    nota: 'diálogo de guardado',
    accion: async (page) => {
      await volver(page);
      await page.getByTestId('data-testid Save dashboard button').click();
      await page.getByTestId('data-testid Save dashboard title field').fill(TITULO);
      // El diálogo entra deslizándose. El clic de prueba espera a que deje de moverse.
      await page.getByRole('button', { name: 'Cancel' }).click({ trial: true });
    },
    imagen: 17,
  },
  {
    tipo: 'web',
    sitio: 'grafana',
    nota: 'dashboard guardado, fila Ahora',
    accion: async (page) => {
      await page.getByRole('button', { name: 'Save', exact: true }).last().click();
      await page.waitForURL(/\/d\//);
      await page.getByText('Dashboard saved').waitFor({ state: 'hidden' });
      await page.getByRole('button', { name: 'Exit edit' }).click().catch(() => {});
      await sinPuntero(page);
    },
    imagen: 18,
  },
  {
    tipo: 'web',
    sitio: 'grafana',
    nota: 'fila Tendencia',
    accion: async (page) => {
      await page.getByTestId('data-testid dashboard-row-title-Tendencia').scrollIntoViewIfNeeded();
      await page.getByTestId('data-testid dashboard-row-title-Tendencia').evaluate((e) => e.scrollIntoView({ block: 'start' }));
    },
    imagen: 19,
  },
  {
    tipo: 'web',
    sitio: 'grafana',
    nota: 'fila Referencia',
    accion: async (page) => {
      await page.getByTestId('data-testid dashboard-row-title-Referencia').evaluate((e) => e.scrollIntoView({ block: 'start' }));
    },
    imagen: 20,
  },

  // --- Paso 6. Exportar el JSON ---------------------------------------------------------
  {
    tipo: 'web',
    sitio: 'grafana',
    nota: 'exportar',
    accion: async (page) => {
      await page.getByRole('button', { name: /^Export/ }).click();
      await page.getByRole('menuitem', { name: /Export as code/ }).click();
      // El panel entra deslizándose. El clic de prueba espera a que deje de moverse.
      await page.getByRole('button', { name: /Download file/ }).click({ trial: true });
    },
    imagen: 21,
  },
  {
    tipo: 'web',
    sitio: 'grafana',
    nota: 'guardar el archivo en Capitulo4/mi-dashboard.json',
    accion: async (page, ayudas) => {
      const descarga = page.waitForEvent('download');
      await page.getByRole('button', { name: /Download file/ }).click();
      await (await descarga).saveAs(ayudas.rutaDelRepo('Capitulo4/mi-dashboard.json'));
    },
  },

  // --- Verificación ---------------------------------------------------------------------
  { tipo: 'terminal', comando: 'Capitulo4/verificar.sh', imagen: 22 },

  // --- Resultado esperado ---------------------------------------------------------------
  {
    tipo: 'web',
    sitio: 'grafana',
    nota: 'dashboard completo en una ventana alta',
    accion: async (page, ayudas) => {
      await page.setViewportSize({ width: 1440, height: 2350 });
      await page.goto(ayudas.urlDe('grafana', new URL(page.url()).pathname));
      await page.getByTestId('data-testid dashboard-row-title-Referencia').waitFor();
      await page.getByText('Tianguis · RED', { exact: true }).last().waitFor();
      await sinPuntero(page);
    },
    imagen: 23,
  },
  {
    tipo: 'web',
    sitio: 'grafana',
    nota: 'ventana normal otra vez',
    accion: (page) => page.setViewportSize({ width: 1440, height: 900 }),
  },
];
