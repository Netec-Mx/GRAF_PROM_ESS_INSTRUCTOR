// Genera las capturas de una práctica a partir de su archivo de pasos.
//
//   node capturar.mjs N        lee pasos/N.mjs y escribe images/N/*.png
//
// Cada paso es de terminal o de web. Los de terminal corren el comando de verdad en la raíz
// del repo y fotografían su salida. Los de web abren la página, esperan a que termine de
// cargar, hacen la acción del paso y fotografían. Un paso sin "imagen" se ejecuta igual, pero
// no deja captura: sirve para dejar el stack como lo tendría el alumno en ese punto.
import { chromium } from 'playwright';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(AQUI, '..', '..');
const VENTANA = { width: 1440, height: 900 };
// Rango de tiempo fijo de todas las capturas de Grafana.
const RANGO = { from: 'now-30m', to: 'now' };

const practica = process.argv[2];
if (!/^[1-9]$/.test(practica ?? '')) {
  console.error('Uso: node capturar.mjs N   (N es el número de la práctica, de 1 a 9)');
  process.exit(2);
}
const archivoDePasos = join(AQUI, 'pasos', `${practica}.mjs`);
if (!existsSync(archivoDePasos)) {
  console.error(`No existe ${archivoDePasos}`);
  process.exit(2);
}

// ---------------------------------------------------------------------------
// infra/.env
// ---------------------------------------------------------------------------
function leerEnv(nombre) {
  const lineas = readFileSync(join(RAIZ, 'infra', '.env'), 'utf8').split(/\r?\n/);
  const linea = lineas.filter((l) => l.startsWith(`${nombre}=`)).pop();
  if (linea === undefined) throw new Error(`Falta ${nombre} en infra/.env`);
  return linea.slice(nombre.length + 1);
}

const sitios = {
  grafana: `http://localhost:${leerEnv('PUERTO_GRAFANA')}`,
  prometheus: `http://localhost:${leerEnv('PUERTO_PROMETHEUS')}`,
  pushgateway: `http://localhost:${leerEnv('PUERTO_PUSHGATEWAY')}`,
  alertmanager: `http://localhost:${leerEnv('PUERTO_ALERTMANAGER')}`,
  mailpit: `http://localhost:${leerEnv('PUERTO_MAILPIT_UI')}`,
  // Práctica 7. Grafana y Prometheus con la capa de seguridad, por https.
  grafanaTls: `https://localhost:${leerEnv('PUERTO_GRAFANA')}`,
  prometheusTls: `https://localhost:${leerEnv('PUERTO_PROMETHEUS')}`,
  dex: 'http://localhost:5556',
  alloy: `http://localhost:${leerEnv('PUERTO_ALLOY')}`,
  loki: `http://localhost:${leerEnv('PUERTO_LOKI')}`,
  // Práctica 9. Grafana y los Prometheus detrás de nginx, cada uno bajo su ruta.
  portalGrafana: 'http://localhost:8088/grafana',
  portalPrometheus: 'http://localhost:8088/prometheus',
  portalBorde: 'http://localhost:8088/borde',
};
// Sitios que son Grafana, por http o por https.
const esGrafana = (sitio) => sitio === 'grafana' || sitio === 'grafanaTls' || sitio === 'portalGrafana';
const grafana = { usuario: leerEnv('GRAFANA_ADMIN_USER'), clave: leerEnv('GRAFANA_ADMIN_PASSWORD') };

// urlDe('grafana', '/dashboard/new')  ->  URL completa. A Grafana se le fija tema claro y rango.
function urlDe(sitio, ruta) {
  // La ruta se suma al final del sitio, así un sitio con prefijo como /grafana lo conserva.
  const url = ruta.startsWith('/') ? new URL(sitios[sitio] + ruta) : new URL(ruta, sitios[sitio]);
  if (esGrafana(sitio)) {
    url.searchParams.set('theme', 'light');
    if (/^\/(d|dashboard|explore)\b/.test(ruta)) {
      url.searchParams.set('from', RANGO.from);
      url.searchParams.set('to', RANGO.to);
    }
  }
  return url.toString();
}

// ---------------------------------------------------------------------------
// Terminal
// ---------------------------------------------------------------------------
function correr(comando, entrada) {
  // Salida normal y de error van juntas y en orden, como las ve el alumno en su terminal.
  const r = spawnSync('bash', ['-c', `{ ${comando}
} 2>&1`], {
    cwd: RAIZ,
    input: entrada ?? '',
    encoding: 'utf8',
    env: { ...process.env, CLICOLOR_FORCE: '1', TERM: 'xterm-256color' },
    maxBuffer: 32 * 1024 * 1024,
  });
  if (r.error) throw r.error;
  return { codigo: r.status, salida: r.stdout };
}

const COLORES = { 31: 'rojo', 32: 'verde', 33: 'amarillo', 36: 'azul' };

function escapar(texto) {
  return texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Una línea que se reescribe con retornos de carro queda como su último estado.
function ultimoEstado(linea) {
  return linea.replace(/\x1b\[K/g, '').split('\r').filter((t) => t !== '').pop() ?? '';
}

// Convierte los colores ANSI que usan los scripts del repo en <span>.
function ansiAHtml(linea) {
  let html = '';
  let abiertos = 0;
  for (const trozo of linea.split(/(\x1b\[[0-9;]*m)/)) {
    const codigo = /^\x1b\[([0-9;]*)m$/.exec(trozo);
    if (!codigo) {
      html += escapar(trozo);
      continue;
    }
    for (const n of (codigo[1] || '0').split(';').map(Number)) {
      if (n === 0) {
        html += '</span>'.repeat(abiertos);
        abiertos = 0;
      } else if (n === 1) {
        html += '<span class="negrita">';
        abiertos += 1;
      } else if (COLORES[n]) {
        html += `<span class="${COLORES[n]}">`;
        abiertos += 1;
      }
    }
  }
  return html + '</span>'.repeat(abiertos);
}

function paginaDeTerminal(comando, salida, ultimas) {
  let lineas = salida.replace(/\r\n/g, '\n').split('\n').map(ultimoEstado);
  while (lineas.length > 0 && lineas[lineas.length - 1].trim() === '') lineas.pop();
  let recortada = false;
  if (ultimas && lineas.length > ultimas) {
    lineas = lineas.slice(-ultimas);
    recortada = true;
  }
  const cuerpo = lineas.map(ansiAHtml).join('\n');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><style>
    body { margin: 0; padding: 24px; background: #ffffff; }
    #terminal { display: inline-block; min-width: 720px; max-width: 1340px; border: 1px solid #c9ced6;
      border-radius: 8px; background: #fbfbfc; padding: 18px 22px; }
    pre { margin: 0; font: 14px/1.5 Menlo, Consolas, "DejaVu Sans Mono", monospace; color: #1f2328;
      white-space: pre-wrap; word-break: break-word; }
    .orden { font-weight: 700; }
    .signo { color: #57606a; }
    .corte { color: #8b949e; }
    .negrita { font-weight: 700; }
    .rojo { color: #c0271d; } .verde { color: #1a7f37; } .amarillo { color: #9a6700; } .azul { color: #0b7285; }
  </style></head><body><div id="terminal"><pre><span class="signo">$</span> <span class="orden">${escapar(comando)}</span>
${recortada ? '<span class="corte">[...]</span>\n' : ''}${cuerpo}</pre></div></body></html>`;
}

// ---------------------------------------------------------------------------
// Esperas que usan los archivos de pasos
// ---------------------------------------------------------------------------
const ayudas = {
  urlDe,
  // Ruta absoluta de un archivo del repo, para guardar ahí lo que el alumno descarga.
  rutaDelRepo: (ruta) => join(RAIZ, ruta),
  sitios,
  correr,
  // Cierra todas las sesiones de Grafana. El paso siguiente vuelve a entrar como admin, o el
  // paso entra como otro usuario.
  async cerrarSesiones(page) {
    sesiones.clear();
    await page.context().clearCookies();
  },
  // Marca una sesión ya abierta a mano por el paso, para que el capturador no entre como admin.
  marcarSesion: (sitio) => sesiones.add(sitio),
  // Espera a que ningún panel de Grafana siga cargando y a que no queden consultas en vuelo.
  async panelesListos(page) {
    await page.waitForFunction(() => {
      const cargando = document.querySelectorAll(
        '[aria-label="Panel loading bar"], [data-testid*="loading-bar" i], [data-testid="Loading indicator"], [data-testid*="Spinner" i]',
      );
      return cargando.length === 0;
    });
  },
  // Hace la acción y espera la respuesta de la consulta que esa acción dispara en Grafana.
  async conConsulta(page, accion) {
    const respuesta = page.waitForResponse((r) => r.url().includes('/api/ds/query') && r.status() === 200);
    await accion();
    await respuesta;
  },
};

// ---------------------------------------------------------------------------
// Corrida
// ---------------------------------------------------------------------------
const { default: pasos } = await import(archivoDePasos);
const destino = join(RAIZ, 'images', practica);
mkdirSync(destino, { recursive: true });
// DESDE=N empieza en el paso N y conserva las imágenes que ya existen. Sirve para retomar una
// corrida larga cuando el stack ya quedó como lo deja el paso anterior.
const DESDE = Number(process.env.DESDE || 0);
if (!DESDE) {
  for (const viejo of readdirSync(destino)) {
    if (/^\d+\.png$/.test(viejo)) rmSync(join(destino, viejo));
  }
}

const navegador = await chromium.launch();
const contexto = await navegador.newContext({
  // La Práctica 7 usa una CA propia que el navegador no conoce.
  ignoreHTTPSErrors: true,
  // Usuario y clave para Prometheus y Alertmanager con autenticación básica. Solo se mandan
  // cuando el servidor los pide.
  ...(practica === '7' ? { httpCredentials: { username: 'tianguis', password: 'mirar-2026' } } : {}),
  acceptDownloads: true,
  viewport: VENTANA,
  deviceScaleFactor: 1,
  colorScheme: 'light',
  locale: 'es-MX',
});
const web = await contexto.newPage();
const terminal = await contexto.newPage();
// Sesión abierta en cada origen de Grafana.
const sesiones = new Set();

async function entrarAGrafana(sitio) {
  await web.goto(`${sitios[sitio]}/login`);
  // Una cookie de localhost sirve para http y https. Si ya hay sesión, /login lleva al inicio.
  await web.waitForLoadState('networkidle').catch(() => {});
  // Detrás de nginx, Grafana vive bajo un prefijo como /grafana.
  const login = `${new URL(sitios[sitio]).pathname.replace(/\/$/, '')}/login`;
  if (!new URL(web.url()).pathname.startsWith(login)) {
    sesiones.add(sitio);
    return;
  }
  await web.fill('input[name="user"]', grafana.usuario);
  await web.fill('input[name="password"]', grafana.clave);
  await web.click('button[type="submit"]');
  await web.waitForURL((u) => !u.pathname.startsWith(login));
  sesiones.add(sitio);
}

async function fotografiar(page, paso) {
  const ruta = join(destino, `${paso.imagen}.png`);
  if (paso.recorte === 'pagina') {
    await page.screenshot({ path: ruta, fullPage: true });
  } else if (typeof paso.recorte === 'string') {
    await page.locator(paso.recorte).first().screenshot({ path: ruta });
  } else if (paso.recorte) {
    await page.screenshot({ path: ruta, clip: paso.recorte });
  } else {
    await page.screenshot({ path: ruta });
  }
  hechas.push(paso.imagen);
  console.log(`   images/${practica}/${paso.imagen}.png`);
}

// HASTA=N corta la corrida después del paso N y deja una foto en tools/capturas/hasta.png.
// Sirve para escribir un archivo de pasos de a poco.
const HASTA = Number(process.env.HASTA || 0);
const hechas = [];
let numero = 0;
try {
  for (const paso of pasos) {
    numero += 1;
    if (DESDE && numero < DESDE) continue;
    console.log(`${String(numero).padStart(2)}. ${paso.nota ?? paso.comando ?? paso.url}`);
    if (paso.tipo === 'terminal') {
      const { codigo, salida } = correr(paso.comando, paso.entrada);
      const esperado = paso.sale ?? 0;
      if (codigo !== esperado) {
        throw new Error(`"${paso.comando}" salió con ${codigo} y se esperaba ${esperado}\n${salida}`);
      }
      if (paso.contiene && !salida.includes(paso.contiene)) {
        throw new Error(`La salida de "${paso.comando}" no contiene "${paso.contiene}"\n${salida}`);
      }
      if (paso.imagen) {
        await terminal.setContent(paginaDeTerminal(paso.comando, salida, paso.ultimas));
        await fotografiar(terminal, { imagen: paso.imagen, recorte: '#terminal' });
      }
    } else if (paso.tipo === 'web') {
      if (esGrafana(paso.sitio) && !sesiones.has(paso.sitio)) await entrarAGrafana(paso.sitio);
      if (paso.url) await web.goto(urlDe(paso.sitio, paso.url));
      if (paso.espera) await paso.espera(web, ayudas);
      if (paso.accion) await paso.accion(web, ayudas);
      if (esGrafana(paso.sitio)) await ayudas.panelesListos(web);
      if (paso.imagen) await fotografiar(web, paso);
    } else {
      throw new Error(`Paso ${numero}: tipo desconocido "${paso.tipo}"`);
    }
    if (HASTA && numero >= HASTA) {
      await web.screenshot({ path: join(AQUI, 'hasta.png'), fullPage: true });
      console.log(`\nCorte en el paso ${numero}. Foto del navegador en tools/capturas/hasta.png`);
      break;
    }
  }
} catch (error) {
  await web.screenshot({ path: join(AQUI, 'fallo.png') }).catch(() => {});
  console.error(`\nFalló el paso ${numero}. Quedó una foto del navegador en tools/capturas/fallo.png`);
  console.error(error.message);
  await navegador.close();
  process.exit(1);
}
await navegador.close();

const esperadas = pasos.filter((p) => p.imagen).map((p) => p.imagen);
const repetidas = esperadas.filter((n, i) => esperadas.indexOf(n) !== i);
if (repetidas.length > 0) {
  console.error(`Hay números de imagen repetidos en pasos/${practica}.mjs: ${repetidas.join(', ')}`);
  process.exit(1);
}
console.log(`\nListo: ${hechas.length} capturas en images/${practica}/`);
