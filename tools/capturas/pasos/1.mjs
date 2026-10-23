// Práctica 1. Mapa de señales y comparación de herramientas para un caso real.
// Cada paso: tipo, sitio y url (o comando), espera, acción, recorte y número de imagen.

const MAPA = 'Capitulo1/mapa-de-senales.md';
const RESPALDO = '"${TMPDIR:-/tmp}/gpe-mapa-de-senales.md"';

export default [
  {
    tipo: 'terminal',
    comando: 'Capitulo1/preparar.sh',
    ultimas: 12,
    imagen: 1,
  },
  {
    tipo: 'web',
    sitio: 'prometheus',
    url: '/targets',
    // Los diez grupos de destinos ya pintaron su contador "1 / 1 up".
    espera: (page) => page.waitForFunction(() => (document.body.innerText.match(/\d+ \/ \d+ up/g) ?? []).length >= 10),
    recorte: 'pagina',
    imagen: 2,
  },
  {
    tipo: 'web',
    sitio: 'prometheus',
    url: '/query?g0.expr=up%7Bjob%3D%22pagos%22%7D&g0.tab=table',
    espera: (page) => page.getByText('Empty query result').waitFor(),
    recorte: { x: 0, y: 0, width: 1440, height: 420 },
    imagen: 3,
  },
  {
    tipo: 'web',
    sitio: 'prometheus',
    url: '/query?g0.expr=payments_processed_total&g0.tab=table',
    espera: (page) => page.getByText(/Result series: \d+/).waitFor(),
    recorte: { x: 0, y: 0, width: 1440, height: 760 },
    imagen: 4,
  },
  {
    tipo: 'web',
    sitio: 'pushgateway',
    url: '/',
    espera: (page) => page.getByText('job="conciliacion"').first().waitFor(),
    accion: async (page) => {
      await page.getByText('job="conciliacion"').first().click();
      await page.getByText('conciliacion_last_run_success').first().waitFor();
      // El grupo se despliega con una animación: se espera a que termine.
      await page.waitForFunction(() => document.querySelectorAll('.collapsing').length === 0 && document.querySelectorAll('.collapse.show').length > 0);
    },
    recorte: 'pagina',
    imagen: 5,
  },
  // La captura final necesita las tablas completas. Se guarda el archivo del alumno, se pone
  // la solución, se verifica y se devuelve el archivo a como estaba.
  { tipo: 'terminal', nota: 'guardar el mapa del alumno', comando: `cp ${MAPA} ${RESPALDO} && cp Capitulo1/solucion/mapa-de-senales.md ${MAPA}` },
  { tipo: 'terminal', comando: 'Capitulo1/verificar.sh', imagen: 6 },
  { tipo: 'terminal', nota: 'devolver el mapa del alumno', comando: `cp ${RESPALDO} ${MAPA} && rm ${RESPALDO}` },
];
