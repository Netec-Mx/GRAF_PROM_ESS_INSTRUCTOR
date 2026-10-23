// Práctica 8. Implementación de Loki y Alloy con microservicios.
// Cada paso: tipo, sitio y url (o comando), espera, acción, recorte y número de imagen.
// Los pasos sin imagen hacen lo que el alumno hace a mano entre una captura y la siguiente.
// Lo que el alumno escribe en un editor se copia desde Capitulo8/solucion.
//
// La alerta del ruler suena y se resuelve con sus tiempos reales. La corrida tarda unos 15 minutos.

const LIB = '. _comun/lib-practicas.sh';
const SOL = 'Capitulo8/solucion';
const ALERTA = 'CatalogoErroresEnLogs';

const alto = (h) => ({ x: 0, y: 0, width: 1440, height: h });
// Explore sin la barra lateral ni el editor de consultas.
const RESULTADO = { x: 500, y: 335, width: 940, height: 565 };
const sinPuntero = (page) => page.mouse.move(720, 890);

// Espera con tope a que una condición de bash se cumpla.
const hasta = (condicion, tope = 600) =>
  `${LIB}; n=0; until ${condicion}; do n=$((n + 3)); [ "$n" -lt ${tope} ] || exit 1; sleep 3; done`;

// Streams que recibieron líneas en los últimos 2 minutos. Es el mismo comando de la guía.
const STREAMS = `ahora=$(date +%s)
curl -s -G http://localhost:3100/loki/api/v1/series --data-urlencode 'match[]={compose_service=~".+"}' --data-urlencode "start=$((ahora - 120))000000000" | grep -o '"compose_service":"[^"]*"' | wc -l`;

// Ningún stream de los últimos 2 minutos tiene la etiqueta level: Alloy ya trabaja sin ella.
const sinLevel = `! curl -s -G http://localhost:3100/loki/api/v1/series --data-urlencode 'match[]={compose_service=~".+"}' --data-urlencode "start=$(( $(date +%s) - 120 ))000000000" | grep -q '"level"'`;
// Ningún stream de catalogo de los últimos 2 minutos queda sin la etiqueta level.
const catalogoConLevel = `! curl -s -G http://localhost:3100/loki/api/v1/series --data-urlencode 'match[]={compose_service="catalogo"}' --data-urlencode "start=$(( $(date +%s) - 120 ))000000000" | tr '}' '\\n' | grep '"compose_service"' | grep -q -v '"level"'`;

const enWebhook = (estado) =>
  `docker logs gpe-webhook 2>&1 | grep '"alertnames":"${ALERTA}"' | grep -q '"status":"${estado}"'`;

function explorarLoki(expr, tipo = 'range') {
  const panes = { a: { datasource: 'loki', queries: [{ refId: 'A', expr, queryType: tipo, datasource: { type: 'loki', uid: 'loki' } }], range: { from: 'now-15m', to: 'now' } } };
  return `/explore?schemaVersion=1&orgId=1&panes=${encodeURIComponent(JSON.stringify(panes))}`;
}
const lineas = async (page) => {
  await page.locator('[data-testid="logRows"], [data-testid="log-line"], [class*="logs-row"]').first().waitFor();
};
const graficos = async (page) => {
  await page.waitForFunction(() => document.querySelectorAll('.u-over').length >= 1);
};
const tabla = async (page) => {
  await page.getByRole('columnheader').first().waitFor();
};
const web = (sitio, url, espera, imagen, recorte, accion) => ({ tipo: 'web', sitio, url, espera, accion, imagen, recorte });

export default [
  // --- Dejar todo como antes de empezar la práctica -------------------------------------
  { tipo: 'terminal', nota: 'devolver Alloy y Loki a git', comando: 'Capitulo8/restaurar.sh', entrada: 'SI\n' },
  {
    tipo: 'terminal',
    nota: 'plantilla de consultas vacía y gpe-webhook con logs vacíos',
    comando: `git checkout -- Capitulo8/consultas.md
      ${LIB}
      compose up -d --force-recreate --no-deps webhook >/dev/null 2>&1`,
  },

  // --- Punto de partida -----------------------------------------------------------------
  { tipo: 'terminal', comando: 'Capitulo8/preparar.sh', imagen: 1 },

  // --- Paso 1. Arquitectura de Loki -----------------------------------------------------
  { tipo: 'terminal', comando: 'cat infra/loki/loki.yaml', imagen: 2 },
  {
    tipo: 'terminal',
    comando: "curl -s http://localhost:3100/config | grep -E '^target:|retention_period:|ingestion_rate_mb:|max_global_streams_per_user:|allow_structured_metadata:|otlp_config:'",
    contiene: 'retention_period',
    imagen: 3,
  },

  // --- Paso 2. La interfaz de Alloy -----------------------------------------------------
  web('alloy', '/graph', async (page) => { await page.getByText('loki.source.docker').first().waitFor(); }, 4, alto(620)),
  web('alloy', '/component/loki.source.docker.contenedores', async (page) => { await page.getByText('Arguments').first().waitFor(); }, 5, alto(800)),

  // --- Paso 3. El pipeline de Alloy -----------------------------------------------------
  { tipo: 'terminal', nota: 'Loki recibe dos minutos sin la etiqueta level', comando: hasta(sinLevel, 300) },
  { tipo: 'terminal', comando: STREAMS, imagen: 6 },
  { tipo: 'terminal', nota: 'el alumno edita config.alloy', comando: `cp ${SOL}/infra/alloy/config.alloy infra/alloy/config.alloy` },
  {
    tipo: 'terminal',
    comando: `MSYS_NO_PATHCONV=1 docker exec gpe-alloy alloy validate /etc/alloy/config.alloy && echo "configuración válida"
curl -s -w '%{http_code}\\n' -X POST http://localhost:12345/-/reload`,
    contiene: '200',
    imagen: 7,
  },
  web('alloy', '/graph', async (page) => { await page.getByText('loki.process').first().waitFor(); }, 8, alto(620)),
  {
    tipo: 'terminal',
    comando: `docker exec gpe-catalogo sh -c 'echo "{\\"level\\": \\"info\\", \\"service\\": \\"catalogo\\", \\"route\\": \\"/salud\\", \\"status\\": 200, \\"msg\\": \\"healthcheck de prueba\\"}" > /proc/1/fd/1'
curl -s http://localhost:12345/metrics | grep 'loki_process_dropped_lines_total{'`,
    contiene: 'reason="healthcheck"',
    imagen: 9,
  },
  { tipo: 'terminal', nota: 'Loki recibe dos minutos con la etiqueta level', comando: hasta(catalogoConLevel, 300) },
  { tipo: 'terminal', comando: 'curl -s http://localhost:3100/loki/api/v1/labels', contiene: '"level"', imagen: 10 },
  { tipo: 'terminal', comando: STREAMS, imagen: 11 },
  web('grafana', explorarLoki('{compose_service="pagos"} | trace_id != ""'), lineas, 12, alto(900), async (page) => {
    await page.locator('[data-testid="logRows"] tr, [data-testid="log-line"]').first().click().catch(() => {});
    await page.getByText('trace_id').first().waitFor();
    await sinPuntero(page);
  }),

  // --- Paso 4. Migración desde Promtail -------------------------------------------------
  {
    tipo: 'terminal',
    comando: 'MSYS_NO_PATHCONV=1 docker exec -i gpe-alloy alloy convert --source-format=promtail --output=/dev/stdout /dev/stdin < Capitulo8/promtail-ejemplo.yaml',
    contiene: 'loki.process',
    imagen: 13,
  },

  // --- Paso 5. Ingesta por OTLP ---------------------------------------------------------
  {
    tipo: 'terminal',
    comando: `curl -s -o /dev/null -w '%{http_code}\\n' -X POST http://localhost:3100/otlp/v1/logs \\
  -H 'Content-Type: application/json' \\
  -d '{"resourceLogs":[{"resource":{"attributes":[{"key":"service.name","value":{"stringValue":"refrigerador"}}]},"scopeLogs":[{"logRecords":[{"timeUnixNano":"'"$(date +%s)"'000000000","severityText":"WARN","body":{"stringValue":"la puerta del refrigerador qued\\u00f3 abierta"},"attributes":[{"key":"pasillo","value":{"stringValue":"3"}},{"key":"temperatura","value":{"doubleValue":9.5}}]}]}]}]}'`,
    contiene: '204',
    imagen: 14,
  },
  { tipo: 'terminal', nota: 'la línea OTLP es consultable', comando: hasta(`curl -s -G http://localhost:3100/loki/api/v1/query_range --data-urlencode 'query={service_name="refrigerador"}' --data-urlencode "start=$(( $(date +%s) - 300 ))000000000" | grep -q 'refrigerador quedó'`, 60) },
  web('grafana', explorarLoki('{service_name="refrigerador"}'), lineas, 15, alto(900), async (page) => {
    await page.getByText('la puerta del refrigerador').first().click();
    await page.getByText('pasillo').first().waitFor();
    await sinPuntero(page);
  }),

  // --- Paso 6. LogQL --------------------------------------------------------------------
  { tipo: 'terminal', nota: 'el alumno copia sus consultas', comando: `cp ${SOL}/consultas.md Capitulo8/consultas.md` },
  // Solo el resultado. El editor mostraría la consulta, que es lo que el alumno tiene que escribir.
  web('grafana', explorarLoki('{compose_service="catalogo"} | json | status >= 500 | line_format "{{.method}} {{.route}} {{.status}} {{.duration_ms}} ms"'), lineas, 16, RESULTADO),
  web('grafana', explorarLoki('sum by (status) (count_over_time({compose_service="catalogo"} | json [5m]))'), graficos, 17, RESULTADO),
  web('grafana', explorarLoki('quantile_over_time(0.95, {compose_service="catalogo"} | json | unwrap duration_ms [5m]) by (route)'), graficos, 18, RESULTADO),

  // --- Paso 7. Logs Drilldown -----------------------------------------------------------
  {
    tipo: 'web',
    sitio: 'grafana',
    url: '/a/grafana-lokiexplore-app/explore',
    nota: 'campos de catalogo',
    accion: async (page) => {
      await page.getByText('Welcome to Grafana Logs Drilldown!').locator('../..').getByRole('button').last().click().catch(() => {});
      await page.getByPlaceholder(/Search/i).first().fill('catalogo');
      await page.getByRole('option', { name: 'gpe-catalogo', exact: true }).click();
      await page.getByRole('tab', { name: /Fields/ }).click();
      await page.getByText('status', { exact: true }).first().waitFor();
      // Elige status en el selector Field para ver un gráfico por cada valor, 200 y 500.
      await page.getByText('Field', { exact: true }).locator('..').locator('..').getByRole('combobox').click();
      await page.keyboard.type('status');
      await page.keyboard.press('Enter');
      await page.getByText('500', { exact: true }).first().waitFor();
      await page.waitForLoadState('networkidle').catch(() => {});
      await sinPuntero(page);
    },
    imagen: 19,
  },

  // --- Paso 8. Regla de alerta en el ruler de Loki --------------------------------------
  {
    tipo: 'terminal',
    nota: 'el alumno configura el ruler y escribe la regla',
    comando: `cp ${SOL}/infra/loki/loki.yaml infra/loki/loki.yaml
      mkdir -p infra/loki/reglas/fake
      cp ${SOL}/infra/loki/reglas/fake/tianguis-logs.yaml infra/loki/reglas/fake/`,
  },
  { tipo: 'terminal', comando: 'docker restart gpe-loki', imagen: 20 },
  { tipo: 'terminal', nota: 'Loki listo', comando: hasta('[ "$(contenedor_salud gpe-loki)" = "healthy" ] && curl -s http://localhost:3100/loki/api/v1/rules | grep -q alert', 180) },
  { tipo: 'terminal', comando: 'curl -s http://localhost:3100/loki/api/v1/rules', contiene: ALERTA, imagen: 21 },
  { tipo: 'terminal', nota: 'la alerta pasa a firing', comando: hasta(`curl -s http://localhost:3100/prometheus/api/v1/alerts | grep -q '"state":"firing"'`, 600) },
  { tipo: 'terminal', comando: 'curl -s http://localhost:3100/prometheus/api/v1/alerts', contiene: 'firing', imagen: 22 },
  { tipo: 'terminal', nota: 'la notificación llega a gpe-webhook', comando: hasta(enWebhook('firing'), 300) },
  web('alertmanager', '/#/alerts', async (page) => { await page.getByText(ALERTA).first().waitFor(); }, 23, alto(420)),
  web('grafana', explorarLoki(`{compose_service="webhook"} | json | alertnames="${ALERTA}"`), lineas, 24, alto(900)),

  // --- Paso 9. Apagar el caos y ver el resuelto -----------------------------------------
  { tipo: 'terminal', comando: 'bin/caos.sh apagar', imagen: 25, ultimas: 3 },
  { tipo: 'terminal', nota: 'llega el resuelto', comando: hasta(enWebhook('resolved'), 900) },
  web('grafana', explorarLoki(`{compose_service="webhook"} | json | alertnames="${ALERTA}" | status="resolved"`), lineas, 26, alto(900)),

  // --- Verificación ---------------------------------------------------------------------
  { tipo: 'terminal', comando: 'Capitulo8/verificar.sh', imagen: 27 },

  // --- Resultado esperado ---------------------------------------------------------------
  web('grafana', explorarLoki('sum by (compose_service, level) (count_over_time({level=~".+"}[1m]))'), graficos, 28, alto(900)),

  // --- Volver al stack base -------------------------------------------------------------
  { tipo: 'terminal', comando: 'Capitulo8/restaurar.sh', entrada: 'SI\n', imagen: 29, ultimas: 10 },
  { tipo: 'terminal', nota: 'plantilla de consultas vacía otra vez', comando: 'git checkout -- Capitulo8/consultas.md' },
];
