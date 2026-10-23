// Práctica 3. Consultas PromQL sobre las métricas de un microservicio.
// Cada paso: tipo, sitio y url (o comando), espera, acción, recorte y número de imagen.
// Los pasos sin imagen hacen lo que el alumno hace a mano entre una captura y la siguiente.

const LIB = '. _comun/lib-practicas.sh';
const CONFIRMADOS = 'orders_created_total{job="pedidos", ambiente="prod", result="confirmed"}';
const P95_NATIVO = 'histogram_quantile(0.95, sum(rate(http_server_request_duration_seconds{job="pedidos", ambiente="prod"}[5m])))';
const P95_CLASICO_PEDIDOS = 'histogram_quantile(0.95, sum by (le) (rate(http_server_request_duration_seconds_bucket{job="pedidos", ambiente="prod"}[5m])))';
const SERIES_CATALOGO = 'count({job="catalogo", ambiente="prod"})';

// consulta(['expr1', 'expr2'], 'graph', '30m')  ->  /query con un panel por consulta.
function consulta(exprs, tab = 'table', rango = '30m') {
  const lista = Array.isArray(exprs) ? exprs : [exprs];
  const partes = lista.map((e, i) =>
    `g${i}.expr=${encodeURIComponent(e)}&g${i}.tab=${tab}&g${i}.range_input=${rango}`);
  return `/query?${partes.join('&')}`;
}

// Espera a que todos los paneles de la página tengan su resultado.
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

// Espera con tope a que una condición de bash se cumpla.
const hasta = (condicion, tope = 420) =>
  `${LIB}; n=0; until ${condicion}; do n=$((n + 3)); [ "$n" -lt ${tope} ] || exit 1; sleep 3; done`;
const valorMayorQue = (expr, minimo) =>
  `awk -v v="$(prom_consulta '${expr}')" -v m=${minimo} 'BEGIN { exit !(v != "" && v + 0 > m) }'`;

const web = (url, espera, imagen, recorte) => ({ tipo: 'web', sitio: 'prometheus', url, espera, imagen, recorte });
const alto = (h) => ({ x: 0, y: 0, width: 1440, height: h });

export default [
  // --- Dejar todo como antes de empezar la práctica -------------------------------------
  { tipo: 'terminal', nota: 'plantilla de consultas vacía', comando: 'git checkout -- Capitulo3/consultas.md' },

  // --- Punto de partida -----------------------------------------------------------------
  { tipo: 'terminal', comando: 'Capitulo3/preparar.sh', imagen: 1 },
  // Tiempo para que catalogo vuelva a tener tráfico de todas sus rutas.
  { tipo: 'terminal', nota: 'tráfico en catalogo', comando: hasta(`[ "$(prom_consulta 'count(http_server_requests_total{job="catalogo", ambiente="prod"})')" -ge 3 ]`) },

  // --- Paso 1. El formato de exposición -------------------------------------------------
  { tipo: 'terminal', comando: 'curl -s http://localhost:8001/metrics | grep "^# TYPE"', imagen: 2 },
  { tipo: 'terminal', comando: 'curl -s http://localhost:8001/metrics | grep \'route="/productos"\'', imagen: 3 },
  { tipo: 'terminal', comando: 'curl -s http://localhost:8002/metrics | grep orders_', imagen: 4 },

  // --- Paso 2. Selectores ---------------------------------------------------------------
  web(consulta('http_server_requests_total{job="pedidos", ambiente="prod"}'), resultados(1), 5, alto(470)),
  web(consulta('http_server_requests_total{job="pedidos", ambiente="prod", status=~"5.."}'), resultados(1), 6, alto(300)),
  web(consulta('http_server_requests_total{job="pedidos", ambiente="prod", status=~"4.."}'), resultados(1), 7, alto(380)),
  web(consulta('{"http_server_requests_total", job="catalogo"}'), resultados(1), 8, alto(560)),

  // --- Paso 3. rate, irate e increase ---------------------------------------------------
  web(consulta(CONFIRMADOS, 'graph'), graficos(1), 9),
  web(consulta([`rate(${CONFIRMADOS}[5m])`, `irate(${CONFIRMADOS}[5m])`], 'graph'), graficos(2), 10, 'pagina'),
  web(consulta(`increase(${CONFIRMADOS}[1h])`), resultados(1), 11, alto(300)),
  // Si se repite la corrida, la ventana todavía puede traer el reinicio de la vez anterior.
  { tipo: 'terminal', nota: 'ningún reinicio reciente de pedidos', comando: hasta(`[ "$(prom_consulta 'resets(${CONFIRMADOS}[5m])')" = "0" ]`) },
  { tipo: 'terminal', comando: 'docker restart gpe-pedidos', imagen: 12 },
  // Unos minutos para que el gráfico muestre el antes y el después.
  { tipo: 'terminal', nota: 'esperar unos minutos de muestras después del reinicio', comando: hasta(`${valorMayorQue(`resets(${CONFIRMADOS}[5m])`, 0)} && ${valorMayorQue('time() - process_start_time_seconds{job="pedidos", ambiente="prod"}', 120)}`) },
  web(consulta([CONFIRMADOS, `rate(${CONFIRMADOS}[5m])`], 'graph', '15m'), graficos(2), 13, 'pagina'),
  web(consulta(`resets(${CONFIRMADOS}[30m])`), resultados(1), 14, alto(300)),

  // --- Paso 4. Agregaciones -------------------------------------------------------------
  web(consulta('rate(http_server_requests_total[5m])'), resultados(1), 15, alto(600)),
  web(consulta('sum by (job, ambiente) (rate(http_server_requests_total[5m]))'), resultados(1), 16, alto(420)),
  web(consulta('topk(3, sum by (job, route) (rate(http_server_requests_total[5m])))'), resultados(1), 17, alto(380)),

  // --- Paso 5. RED de pedidos -----------------------------------------------------------
  web(consulta('sum(rate(http_server_requests_total{job="pedidos", ambiente="prod"}[5m]))'), resultados(1), 18, alto(300)),
  web(consulta('sum(rate(http_server_requests_total{job="pedidos", ambiente="prod", status=~"5.."}[5m])) / sum(rate(http_server_requests_total{job="pedidos", ambiente="prod"}[5m]))'), resultados(1), 19, alto(330)),
  web(consulta('(sum(rate(http_server_requests_total{job="pedidos", ambiente="prod", status=~"5.."}[5m])) or vector(0)) / sum(rate(http_server_requests_total{job="pedidos", ambiente="prod"}[5m]))'), resultados(1), 20, alto(330)),
  web(consulta(P95_NATIVO), resultados(1), 21, alto(300)),

  // --- Paso 6. Tres distribuciones ------------------------------------------------------
  web(consulta('histogram_quantile(0.95, sum by (le) (rate(http_server_request_duration_seconds_bucket{job="catalogo", ambiente="prod"}[5m])))'), resultados(1), 22, alto(300)),
  web(consulta('http_server_request_duration_seconds{job="pedidos", ambiente="prod", method="POST"}'), resultados(1), 23, alto(620)),
  web(consulta([P95_NATIVO, P95_CLASICO_PEDIDOS]), resultados(2), 24, alto(560)),
  web(consulta('orders_lines_per_order{quantile="0.9"}'), resultados(1), 25, alto(380)),

  // --- Paso 7. USE con node_exporter ----------------------------------------------------
  web(consulta([
    '1 - avg(rate(node_cpu_seconds_total{mode="idle"}[5m]))',
    'node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes',
    'sum(node_load1) / count(node_cpu_seconds_total{mode="idle"})',
  ]), resultados(3), 26, 'pagina'),

  // --- Paso 8. Caos de latencia ---------------------------------------------------------
  { tipo: 'terminal', nota: 'p95 normal antes del caos', comando: hasta(`! ${valorMayorQue(`max_over_time((${P95_NATIVO})[1m:15s])`, 0.05)}`, 720) },
  { tipo: 'terminal', comando: 'bin/caos.sh pedidos latencia ms=300 porcentaje=20 duracion_s=900', imagen: 27 },
  { tipo: 'terminal', nota: 'esperar a que el p95 lo note', comando: hasta(valorMayorQue(`min_over_time((${P95_NATIVO})[1m:15s])`, 0.25)) },
  web(consulta([P95_NATIVO, 'histogram_quantile(0.50, sum(rate(http_server_request_duration_seconds{job="pedidos", ambiente="prod"}[5m])))'], 'graph', '15m'), graficos(2), 28, 'pagina'),
  { tipo: 'terminal', comando: 'bin/caos.sh pedidos latencia off', contiene: 'apagada' },

  // --- Paso 9. La bomba de cardinalidad -------------------------------------------------
  web(consulta(['prometheus_tsdb_head_series', SERIES_CATALOGO]), resultados(2), 29, alto(560)),
  web(consulta('sort_desc(count by (job) ({__name__=~".+"}))'), resultados(1), 30, alto(640)),
  { tipo: 'terminal', comando: 'bin/caos.sh catalogo cardinalidad', imagen: 31 },
  { tipo: 'terminal', comando: 'Capitulo3/rafaga-skus.sh', imagen: 32 },
  { tipo: 'terminal', nota: 'esperar el scrape de la ráfaga', comando: hasta(valorMayorQue(SERIES_CATALOGO, 2500), 120) },
  { tipo: 'terminal', nota: 'esperar a que Prometheus cuente sus propias series nuevas', comando: hasta(valorMayorQue('prometheus_tsdb_head_series - prometheus_tsdb_head_series offset 2m', 2500), 120) },
  web(consulta(['prometheus_tsdb_head_series', SERIES_CATALOGO]), resultados(2), 33, alto(560)),
  web(consulta('topk(5, count by (__name__) ({job="catalogo"}))'), resultados(1), 34, alto(440)),
  web(consulta('count by (route) (http_server_requests_total{job="catalogo", ambiente="prod"})'), resultados(1), 35, alto(560)),
  { tipo: 'terminal', comando: 'bin/caos.sh catalogo cardinalidad off', contiene: 'apagada' },
  { tipo: 'terminal', comando: 'docker restart gpe-catalogo' },
  { tipo: 'terminal', nota: 'esperar a que Prometheus marque las series viejas', comando: hasta(`[ "$(prom_consulta '${SERIES_CATALOGO}')" -lt 200 ]`, 120) },
  web(consulta(['prometheus_tsdb_head_series', SERIES_CATALOGO]), resultados(2), 36, alto(560)),

  // --- Paso 10. Consultas y verificación ------------------------------------------------
  { tipo: 'terminal', nota: 'el alumno completa consultas.md', comando: 'cp Capitulo3/solucion/consultas.md Capitulo3/consultas.md' },
  { tipo: 'terminal', comando: 'Capitulo3/verificar.sh', imagen: 37 },

  // --- Resultado esperado ---------------------------------------------------------------
  web(consulta(SERIES_CATALOGO, 'graph', '15m'), graficos(1), 38),
  { tipo: 'terminal', nota: 'dejar la plantilla como está en git', comando: 'git checkout -- Capitulo3/consultas.md' },
];
