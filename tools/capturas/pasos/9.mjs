// Práctica 9. Proxy inverso y escritura remota hacia almacenamiento de largo plazo.
// Cada paso: tipo, sitio y url (o comando), espera, acción, recorte y número de imagen.
// Los pasos sin imagen hacen lo que el alumno hace a mano entre una captura y la siguiente.
// Lo que el alumno escribe en un editor sale de 9-etapas.mjs o de Capitulo9/solucion.
//
// Las alertas de El Buen Fin suenan y se resuelven con sus tiempos reales. La corrida tarda
// unos 25 minutos.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GRAFANA } from './puertos.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
// Los comandos de la guía usan $CLAVE, la clave de admin de Grafana, como en la terminal del alumno.
process.env.CLAVE = readFileSync(join(RAIZ, 'infra', '.env'), 'utf8')
  .split(/\r?\n/).filter((l) => l.startsWith('GRAFANA_ADMIN_PASSWORD=')).pop().slice('GRAFANA_ADMIN_PASSWORD='.length);

const LIB = '. _comun/lib-practicas.sh';
const SOL = 'Capitulo9/solucion';
const ETAPA = (n) => `node tools/capturas/pasos/9-etapas.mjs ${n}`;
const CAPA = 'docker compose -p gpe --env-file infra/.env -f infra/compose.yaml -f Capitulo9/compose.escala.yaml';
const PORTAL = 'http://localhost:8088';
const RECARGAR = 'docker exec gpe-prometheus kill -HUP 1';

const alto = (h) => ({ x: 0, y: 0, width: 1440, height: h });
const sinPuntero = (page) => page.mouse.move(720, 890);
const texto = (t) => async (page) => { await page.getByText(t).filter({ visible: true }).first().waitFor(); };
const web = (sitio, url, espera, imagen, recorte, accion) => ({ tipo: 'web', sitio, url, espera, accion, imagen, recorte });

// Espera con tope a que una condición de bash se cumpla.
const hasta = (condicion, tope = 300) =>
  `${LIB}; n=0; until ${condicion}; do n=$((n + 3)); [ "$n" -lt ${tope} ] || exit 1; sleep 3; done`;
// Consulta al Prometheus principal a través de nginx. 0 si devuelve al menos una serie.
const hay = (consulta) =>
  `curl -s -G ${PORTAL}/prometheus/api/v1/query --data-urlencode 'query=${consulta}' | grep -q '"value":\\['`;
// Los siete contenedores de la capa healthy. El subshell hace que exit corte solo el bucle.
const CAPA_SANA = '( for c in gpe-nginx gpe-postgres gpe-grafana gpe-grafana-2 gpe-prometheus gpe-prometheus-borde gpe-mimir; do [ "$(contenedor_salud "$c")" = healthy ] || exit 1; done )';

function explorar(uid, tipo, expr, extra = {}) {
  const panes = { a: { datasource: uid, queries: [{ refId: 'A', expr, query: expr, queryType: extra.queryType ?? 'range', datasource: { type: tipo, uid }, ...extra }], range: { from: 'now-15m', to: 'now' } } };
  return `/explore?schemaVersion=1&orgId=1&panes=${encodeURIComponent(JSON.stringify(panes))}`;
}
const graficos = async (page) => {
  await page.waitForFunction(() => document.querySelectorAll('.u-over').length >= 1);
};
const lineas = async (page) => {
  await page.locator('[data-testid="logRows"], [data-testid="log-line"], [class*="logs-row"]').first().waitFor();
};

// Un pago lento reciente, con pasarela.cobrar sobre 2 segundos. Devuelve un trace_id de 32.
async function trazaLenta(page) {
  const ahora = Math.floor(Date.now() / 1000);
  const q = encodeURIComponent('{ name = "pasarela.cobrar" && duration > 2s }');
  const r = await page.request.get(`http://localhost:3200/api/search?q=${q}&start=${ahora - 900}&end=${ahora}&limit=20`);
  const ids = ((await r.json()).traces ?? []).map((t) => t.traceID).filter((id) => id.length === 32);
  if (ids.length === 0) throw new Error('Tempo no tiene pagos lentos en los últimos 15 minutos');
  return ids[0];
}

export default [
  // --- Dejar todo como antes de empezar la práctica -------------------------------------
  { tipo: 'terminal', nota: 'bajar la capa de una corrida anterior', comando: 'Capitulo9/restaurar.sh', entrada: 'SI\n' },
  { tipo: 'terminal', comando: 'Capitulo9/preparar.sh', imagen: 1 },

  // --- Base de datos y réplicas ---------------------------------------------------------
  {
    tipo: 'terminal',
    comando: `mkdir -p Capitulo9/respaldo
for uid in $(curl -s -u "admin:$CLAVE" "http://localhost:${GRAFANA}/api/search?type=dash-db" | grep -o '"uid":"[^"]*"' | cut -d'"' -f4); do
  curl -s -u "admin:$CLAVE" "http://localhost:${GRAFANA}/api/dashboards/uid/$uid" > "Capitulo9/respaldo/$uid.json"
done
ls Capitulo9/respaldo`,
    imagen: 2,
  },
  { tipo: 'terminal', nota: 'el alumno crea el archivo de la clave', comando: 'cp Capitulo9/secretos/postgres.ejemplo Capitulo9/secretos/postgres' },
  { tipo: 'terminal', comando: `${CAPA} up -d`, imagen: 3, ultimas: 14 },
  { tipo: 'terminal', nota: 'la capa entera healthy', comando: hasta(CAPA_SANA, 300) },
  { tipo: 'terminal', comando: `docker exec gpe-postgres psql -U grafana -d grafana -c '\\dt' | head -n 16`, imagen: 4 },
  {
    tipo: 'terminal',
    comando: `for archivo in Capitulo9/respaldo/*.json; do
  curl -s -u "admin:$CLAVE" -H 'Content-Type: application/json' -X POST ${PORTAL}/grafana/api/dashboards/db -d @"$archivo"; echo
done`,
    contiene: '"status":"success"',
    imagen: 5,
  },
  web('portalGrafana', '/dashboards', texto('Tianguis · RED'), 6, alto(640)),
  {
    tipo: 'terminal',
    comando: `for i in 1 2 3 4; do curl -s -o /dev/null -D - ${PORTAL}/grafana/api/health | grep -i x-replica; done`,
    imagen: 7,
  },
  {
    tipo: 'terminal',
    comando: `docker stop gpe-grafana-2 && sleep 15
for i in 1 2 3 4 5 6; do curl -s -o /dev/null -w '%{http_code} ' ${PORTAL}/grafana/api/health; done; echo`,
    imagen: 8,
  },
  { tipo: 'terminal', nota: 'volver a encender la réplica', comando: `docker start gpe-grafana-2 >/dev/null && ${hasta('[ "$(contenedor_salud gpe-grafana-2)" = healthy ]', 180)}` },

  // --- Organizaciones, equipos y carpetas -----------------------------------------------
  // Se crean sobre PostgreSQL. Grafana 13.2.3 no puede borrar una organización, y restaurar.sh
  // se las lleva junto con el volumen de PostgreSQL.
  {
    tipo: 'terminal',
    comando: `curl -s -u "admin:$CLAVE" -H 'Content-Type: application/json' -X POST ${PORTAL}/grafana/api/orgs -d '{"name":"Sindicato de Fruteros"}'`,
    contiene: 'orgId',
    imagen: 9,
  },
  web('portalGrafana', '/admin/orgs', texto('Sindicato de Fruteros'), 10, alto(520)),
  web('portalGrafana', '/connections/datasources?orgId=2', async (page) => {
    await page.getByText(/No data sources defined|Add data source|Add new data source/).first().waitFor();
  }, 11, alto(620)),
  web('portalGrafana', '/dashboards?orgId=2', async (page) => {
    await page.getByText('Sindicato de Fruteros').first().waitFor();
    await page.waitForLoadState('networkidle').catch(() => {});
  }, 12, alto(620)),
  { tipo: 'web', sitio: 'portalGrafana', url: '/?orgId=1', nota: 'volver a Main Org.' },
  {
    tipo: 'terminal',
    comando: `EQUIPO=$(curl -s -u "admin:$CLAVE" -H 'Content-Type: application/json' -X POST ${PORTAL}/grafana/api/teams -d '{"name":"equipo-lacteos"}' | grep -o '"teamId":[0-9]*' | cut -d: -f2)
curl -s -u "admin:$CLAVE" -H 'Content-Type: application/json' -X POST ${PORTAL}/grafana/api/folders -d '{"uid":"lacteos","title":"L\\u00e1cteos"}' | grep -o '"title":"[^"]*"'
curl -s -u "admin:$CLAVE" -H 'Content-Type: application/json' -X POST ${PORTAL}/grafana/api/folders/lacteos/permissions -d '{"items":[{"teamId":'"$EQUIPO"',"permission":2}]}'`,
    contiene: 'Folder permissions updated',
    imagen: 13,
  },
  {
    tipo: 'web',
    sitio: 'portalGrafana',
    url: '/dashboards/f/lacteos/',
    nota: 'permisos de la carpeta Lácteos',
    accion: async (page) => {
      await page.getByRole('button', { name: /Folder actions/ }).click();
      await page.getByRole('menuitem', { name: /Manage permissions/ }).click();
      const cajon = page.getByRole('dialog');
      await cajon.getByText('Loading permissions').waitFor({ state: 'hidden' }).catch(() => {});
      await cajon.getByRole('row').filter({ hasText: 'equipo-lacteos' }).first().waitFor();
      // El cajón entra deslizándose desde la derecha.
      await page.waitForTimeout(1500);
      await sinPuntero(page);
    },
    imagen: 14,
  },

  // --- Dashboards como código ---------------------------------------------------
  { tipo: 'terminal', comando: 'cat Capitulo9/escala/grafana/dashboards/proveedores.yaml', imagen: 15 },
  web('portalGrafana', '/d/tianguis-pizarron', texto('Pedidos por minuto'), 16, alto(520)),
  {
    tipo: 'web',
    sitio: 'portalGrafana',
    url: '/d/tianguis-pizarron',
    nota: 'Grafana no deja guardar',
    accion: async (page) => {
      await page.getByText('Pedidos por minuto').first().waitFor();
      await page.getByRole('button', { name: 'Enter edit mode' }).click();
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await page.getByText(/cannot be saved from the Grafana UI/).first().waitFor();
      await page.waitForTimeout(1000);
      await sinPuntero(page);
    },
    imagen: 17,
  },
  { tipo: 'terminal', nota: 'el alumno cambia un título en el JSON', comando: `perl -pi -e 's/"Productos sin stock"/"Productos agotados"/' Capitulo9/dashboards/tianguis-pizarron.json && sleep 15` },
  web('portalGrafana', '/d/tianguis-pizarron', texto('Productos agotados'), 18, alto(520)),

  // --- Proxy inverso ------------------------------------------------------------
  web('portalPrometheus', '/query', texto('Execute'), 19, alto(420)),
  {
    tipo: 'terminal',
    comando: `curl -s -o /dev/null -w '%{http_code} %{redirect_url}\\n' ${PORTAL}/grafana/
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\\n' ${PORTAL}/prometheus/`,
    imagen: 20,
  },
  { tipo: 'terminal', nota: 'el alumno comenta GF_SERVER_ROOT_URL', comando: `perl -pi -e 's/^(  GF_SERVER_ROOT_URL:)/  # $1/' Capitulo9/compose.escala.yaml && ${CAPA} up -d grafana grafana-2 >/dev/null 2>&1 && ${hasta('[ "$(contenedor_salud gpe-grafana)" = healthy ] && [ "$(contenedor_salud gpe-grafana-2)" = healthy ]', 180)}` },
  {
    tipo: 'terminal',
    comando: `curl -s -o /dev/null -w '%{http_code} %{redirect_url}\\n' ${PORTAL}/grafana/
curl -s -o /dev/null -w '%{http_code}\\n' ${PORTAL}/login`,
    imagen: 21,
  },
  { tipo: 'terminal', nota: 'el alumno vuelve a dejar root_url y comenta external-url', comando: `git checkout -- Capitulo9/compose.escala.yaml && perl -pi -e 's/^(      - --web.external-url=http:\\/\\/localhost:8088\\/prometheus\\/)/      # $1/' Capitulo9/compose.escala.yaml && ${CAPA} up -d grafana grafana-2 prometheus >/dev/null 2>&1 && ${hasta('[ "$(contenedor_salud gpe-prometheus)" = healthy ] && [ "$(contenedor_salud gpe-grafana)" = healthy ]', 180)}` },
  {
    tipo: 'terminal',
    comando: `curl -s -o /dev/null -w '%{http_code} %{redirect_url}\\n' ${PORTAL}/prometheus/
curl -s -o /dev/null -w '%{http_code}\\n' ${PORTAL}/query`,
    imagen: 22,
  },
  { tipo: 'terminal', nota: 'el alumno vuelve a dejar external-url', comando: `git checkout -- Capitulo9/compose.escala.yaml && ${CAPA} up -d prometheus >/dev/null 2>&1 && ${hasta('[ "$(contenedor_salud gpe-prometheus)" = healthy ] && [ "$(contenedor_salud gpe-grafana)" = healthy ] && [ "$(contenedor_salud gpe-grafana-2)" = healthy ]', 180)}` },

  // --- Descubrimiento de servicios ----------------------------------------------
  {
    tipo: 'terminal',
    nota: 'el alumno escribe los archivos de destinos',
    comando: `mkdir -p Capitulo9/prometheus/destinos && cp ${SOL}/prometheus/destinos/catalogo.yml Capitulo9/prometheus/destinos/ && printf '%s\\n' '# Destinos del job pedidos que vienen de archivo. Prometheus vuelve a leerlo cuando cambia.' '[]' > Capitulo9/prometheus/destinos/pedidos.yml`,
  },
  { tipo: 'terminal', comando: 'cat Capitulo9/prometheus/destinos/catalogo.yml Capitulo9/prometheus/destinos/pedidos.yml', imagen: 23 },
  { tipo: 'terminal', nota: 'el alumno cambia los jobs y agrega el de HTTP', comando: `${ETAPA(5)} && docker exec gpe-prometheus promtool check config /etc/prometheus-escala/prometheus.yml >/dev/null && ${RECARGAR}` },
  { tipo: 'terminal', nota: 'Prometheus encuentra los destinos', comando: hasta(hay('up{job="descubierto-por-http"} == 1'), 120) },
  web('portalPrometheus', '/targets?search=dev', texto('catalogo-dev:8000'), 24, alto(560)),
  { tipo: 'terminal', nota: 'el alumno agrega pedidos-dev al archivo', comando: `cp ${SOL}/prometheus/destinos/pedidos.yml Capitulo9/prometheus/destinos/pedidos.yml` },
  { tipo: 'terminal', nota: 'pedidos-dev aparece sin recargar', comando: hasta(`curl -s ${PORTAL}/prometheus/api/v1/targets?state=active | tr '{' '\\n' | grep -A3 '"pedidos-dev:8080"' | grep -q '"health":"up"'`, 120) },
  web('portalPrometheus', '/targets?search=dev', texto('pedidos-dev:8080'), 25, alto(760)),
  web('portalPrometheus', '/targets?search=descubierto', texto('prometheus-borde:9090'), 26, alto(420)),

  // --- Federación ---------------------------------------------------------------
  { tipo: 'terminal', nota: 'el alumno agrega el job de federación', comando: `cp ${SOL}/borde/prometheus.yml Capitulo9/borde/prometheus.yml && docker exec gpe-prometheus-borde kill -HUP 1` },
  { tipo: 'terminal', nota: 'el borde trae series', comando: hasta(`curl -s -G ${PORTAL}/borde/api/v1/query --data-urlencode 'query=up{job="federacion"} == 1' | grep -q '"value":\\['`, 120) },
  web('portalBorde', '/targets', texto('federacion'), 27, alto(520)),
  {
    tipo: 'terminal',
    comando: `curl -s -G ${PORTAL}/borde/api/v1/query --data-urlencode 'query=count({__name__=~".+", job!="prometheus-borde"})' | grep -o '"value":\\[[^]]*\\]'
curl -s -G ${PORTAL}/prometheus/api/v1/query --data-urlencode 'query=prometheus_tsdb_head_series{job="prometheus"}' | grep -o '"value":\\[[^]]*\\]'`,
    imagen: 28,
  },

  // --- Escritura remota hacia Mimir ---------------------------------------------
  { tipo: 'terminal', nota: 'el alumno agrega remote_write', comando: `${ETAPA(7)} && docker exec gpe-prometheus promtool check config /etc/prometheus-escala/prometheus.yml >/dev/null && ${RECARGAR}` },
  { tipo: 'terminal', nota: 'Prometheus ya envía', comando: hasta(hay('prometheus_remote_storage_samples_total{remote_name="mimir"} > 0'), 120) },
  {
    tipo: 'terminal',
    comando: `curl -s -u "admin:$CLAVE" -H 'Content-Type: application/json' -X POST ${PORTAL}/grafana/api/datasources -d '{"name":"Mimir","uid":"mimir","type":"prometheus","access":"proxy","url":"http://mimir:9009/prometheus","jsonData":{"httpMethod":"POST","prometheusType":"Mimir"}}' | grep -o '"message":"[^"]*"'`,
    contiene: 'Datasource added',
  },
  {
    tipo: 'web',
    sitio: 'portalGrafana',
    url: '/connections/datasources/edit/mimir',
    nota: 'probar el datasource Mimir',
    accion: async (page) => {
      await page.getByRole('button', { name: 'Save & test' }).click();
      await page.getByText(/Successfully queried the Prometheus API/).waitFor({ timeout: 30000 });
      await page.getByText(/Successfully queried the Prometheus API/).scrollIntoViewIfNeeded();
      await sinPuntero(page);
    },
    imagen: 29,
  },
  { tipo: 'terminal', nota: 'Mimir ya tiene la serie', comando: hasta(`curl -s -u "admin:$CLAVE" -G ${PORTAL}/grafana/api/datasources/proxy/uid/mimir/api/v1/query --data-urlencode 'query=up{job="catalogo"}' | grep -q '"value":\\['`, 180) },
  {
    tipo: 'web',
    sitio: 'portalGrafana',
    nota: 'Explore con Mimir',
    accion: async (page, ayudas) => {
      // La consulta instantánea ya responde, pero el rango de Explore puede tardar un poco más.
      for (let i = 0; i < 12; i++) {
        await page.goto(ayudas.urlDe('portalGrafana', explorar('mimir', 'prometheus', 'up{job="catalogo"}')));
        if (await page.waitForFunction(() => document.querySelectorAll('.u-over').length >= 1, null, { timeout: 15000 }).then(() => true, () => false)) break;
      }
      await graficos(page);
    },
    imagen: 30,
    recorte: alto(760),
  },
  {
    tipo: 'terminal',
    comando: `for q in 'prometheus_remote_storage_samples_total' 'prometheus_remote_storage_shards' 'prometheus_remote_storage_highest_timestamp_in_seconds - ignoring(remote_name, url) group_right prometheus_remote_storage_queue_highest_sent_timestamp_seconds'; do
  echo "$q"; curl -s -G ${PORTAL}/prometheus/api/v1/query --data-urlencode "query=$q" | grep -o '"value":\\[[^]]*\\]'
done`,
    imagen: 31,
  },

  // --- Control de recursos ------------------------------------------------------
  {
    tipo: 'terminal',
    comando: `for q in 'prometheus_tsdb_head_series{job="prometheus"}' 'count({job="loki"})' 'scrape_samples_scraped{job="loki"}'; do
  echo "$q"; curl -s -G ${PORTAL}/prometheus/api/v1/query --data-urlencode "query=$q" | grep -o '"value":\\[[^]]*\\]'
done`,
    imagen: 32,
  },
  { tipo: 'terminal', nota: 'el alumno pone los cupos', comando: `${ETAPA('8a')} && docker exec gpe-prometheus promtool check config /etc/prometheus-escala/prometheus.yml >/dev/null && ${RECARGAR}` },
  { tipo: 'terminal', nota: 'loki queda abajo', comando: hasta(hay('up{job="loki"} == 0'), 120) },
  web('portalPrometheus', '/targets?search=loki', texto(/sample limit/i), 33, alto(520)),
  { tipo: 'terminal', nota: 'el alumno agrega el descarte y la retención', comando: `${ETAPA(8)} && docker exec gpe-prometheus promtool check config /etc/prometheus-escala/prometheus.yml >/dev/null && ${RECARGAR}` },
  { tipo: 'terminal', nota: 'loki vuelve', comando: hasta(hay('up{job="loki"} == 1'), 120) + ' && sleep 30' },
  {
    tipo: 'terminal',
    comando: `for q in 'prometheus_tsdb_head_series{job="prometheus"}' 'count({job="loki"})' 'scrape_samples_scraped{job="loki"}' 'scrape_samples_post_metric_relabeling{job="loki"}'; do
  echo "$q"; curl -s -G ${PORTAL}/prometheus/api/v1/query --data-urlencode "query=$q" | grep -o '"value":\\[[^]]*\\]'
done`,
    imagen: 34,
  },
  { tipo: 'terminal', comando: `curl -s ${PORTAL}/prometheus/api/v1/status/runtimeinfo | grep -o '"storageRetention":"[^"]*"'`, imagen: 35 },

  // --- Grafana Advisor ----------------------------------------------------------
  {
    tipo: 'web',
    sitio: 'portalGrafana',
    url: '/a/grafana-advisor-app',
    nota: 'revisión de Advisor',
    accion: async (page) => {
      const boton = page.getByRole('button', { name: /Refresh|Run checks|Generate report/i }).first();
      await boton.click();
      await page.getByText(/Last checked|issues?|No issues found|All checks passed/i).first().waitFor({ timeout: 120000 });
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.waitForTimeout(3000);
      await sinPuntero(page);
    },
    imagen: 36,
    recorte: 'pagina',
  },

  // --- Parte B. El Buen Fin --------------------------------------------------------------
  { tipo: 'terminal', comando: 'Capitulo9/preparar-buenfin.sh', imagen: 37 },
  { tipo: 'terminal', nota: 'suenan las alertas', comando: hasta(`[ "$(curl -s -G ${PORTAL}/prometheus/api/v1/query --data-urlencode 'query=count(ALERTS{alertstate="firing"})' | sed -n 's/.*,"\\([0-9]*\\)"\\].*/\\1/p')" -ge 3 ]`, 600) },
  {
    tipo: 'web',
    sitio: 'portalPrometheus',
    url: '/alerts',
    nota: 'las alertas de El Buen Fin en Firing',
    // La página no se refresca sola. Se recarga hasta que el grupo buenfin muestre FIRING, que en
    // el HTML está en minúsculas.
    accion: async (page) => {
      for (let i = 0; i < 40; i++) {
        await page.getByText('PagosLentos').first().waitFor();
        if (await page.getByText(/firing/i).filter({ visible: true }).count()) break;
        await page.waitForTimeout(15000);
        await page.reload();
      }
      await page.getByText(/firing/i).filter({ visible: true }).first().waitFor({ timeout: 5000 });
    },
    imagen: 38,
    recorte: alto(620),
  },
  {
    tipo: 'web',
    sitio: 'portalGrafana',
    nota: 'el dashboard Tianguis · RED del respaldo',
    accion: async (page, ayudas) => {
      // La Práctica 4 lo crea en la interfaz, así que su uid cambia en cada corrida.
      const r = await page.request.get(ayudas.urlDe('portalGrafana', `/api/search?type=dash-db&query=${encodeURIComponent('Tianguis · RED')}`));
      const uid = ((await r.json()) ?? []).find((d) => d.title === 'Tianguis · RED')?.uid;
      if (!uid) throw new Error('Grafana no tiene el dashboard Tianguis · RED');
      await page.goto(ayudas.urlDe('portalGrafana', `/d/${uid}`));
      await graficos(page);
    },
    imagen: 39,
    recorte: alto(900),
  },
  web('portalGrafana', explorar('tempo', 'tempo', '{ name = "pasarela.cobrar" && duration > 2s }', { queryType: 'traceql', limit: 20, tableType: 'traces' }), async (page) => {
    await page.getByRole('columnheader').first().waitFor();
  }, 40, alto(760)),
  {
    tipo: 'web',
    sitio: 'portalGrafana',
    nota: 'la traza de un pago lento',
    accion: async (page, ayudas) => {
      const id = await trazaLenta(page);
      await page.goto(ayudas.urlDe('portalGrafana', explorar('tempo', 'tempo', id, { queryType: 'traceql' })));
      await page.getByText('pasarela.cobrar').first().waitFor();
      await sinPuntero(page);
    },
    imagen: 41,
    recorte: alto(760),
  },
  web('portalGrafana', explorar('loki', 'loki', '{compose_service="catalogo-dev"} | json | status >= 500'), lineas, 42, alto(760)),
  {
    tipo: 'terminal',
    nota: 'el alumno escribe el diagnóstico',
    comando: `T=$(curl -s -G http://localhost:3200/api/search --data-urlencode 'q={ name = "pasarela.cobrar" && duration > 2s }' --data-urlencode "start=$(( $(date +%s) - 900 ))" --data-urlencode "end=$(date +%s)" | grep -o '"traceID":"[0-9a-f]\\{32\\}"' | head -n 1 | cut -d'"' -f4)
[ -n "$T" ] && sed "s/2558a4ab7a120231c0d2aee48b0ce98b/$T/" ${SOL}/diagnostico.md > Capitulo9/diagnostico.md`,
  },
  { tipo: 'terminal', comando: 'bin/caos.sh apagar && bin/trafico.sh nivel normal', imagen: 43, ultimas: 8 },
  { tipo: 'terminal', nota: 'se resuelven las alertas', comando: hasta(`! curl -s -G ${PORTAL}/prometheus/api/v1/query --data-urlencode 'query=count(ALERTS{alertname=~"ErroresAltos|LatenciaAlta|PagosLentos"})' | grep -q '"value"'`, 900) },
  web('portalPrometheus', '/alerts', texto('PagosLentos'), 44, alto(520)),

  // --- Verificar ------------------------------------------------------------------------
  { tipo: 'terminal', comando: 'Capitulo9/verificar.sh', imagen: 45 },
  web('portalGrafana', '/dashboards', texto('Tianguis · RED'), 46, alto(640)),

  // --- Volver al stack base -------------------------------------------------------------
  { tipo: 'terminal', comando: 'Capitulo9/restaurar.sh', entrada: 'SI\n', imagen: 47, ultimas: 14 },
  { tipo: 'terminal', comando: 'bin/estado.sh', imagen: 48 },
];
