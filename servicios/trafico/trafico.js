// Clientela de Tianguis Digital.
//
// Cada cliente virtual (VU) repite sin parar: elige un recorrido, lo hace con pausas de
// persona entre petición y petición, y vuelve a empezar. Corre dentro del contenedor gpe-k6.
//
// El número de clientes se cambia en vivo, sin reiniciar, con bin/trafico.sh.

import http from 'k6/http';
import { sleep } from 'k6';

// Dónde está cada ambiente. dev no tiene pagos: allá la compra termina en el pedido, sin pagar.
const PROD = {
  nombre: 'prod',
  catalogo: __ENV.CATALOGO_URL || 'http://catalogo:8000',
  pedidos: __ENV.PEDIDOS_URL || 'http://pedidos:8080',
  pagos: __ENV.PAGOS_URL || 'http://pagos:8080',
};
const DEV = {
  nombre: 'dev',
  catalogo: __ENV.CATALOGO_DEV_URL || 'http://catalogo-dev:8000',
  pedidos: __ENV.PEDIDOS_DEV_URL || 'http://pedidos-dev:8080',
};

// Clientes al arrancar: el nivel "normal". Tope de clientes: el de bin/trafico.sh.
const CLIENTES_AL_ARRANCAR = 5;
const CLIENTES_MAXIMO = 60;

export const options = {
  scenarios: {
    clientela: {
      // Este executor no decide cuántos clientes hay: lo decide quien lo controla desde
      // afuera, con k6 scale, k6 pause y k6 resume. Eso es lo que usa bin/trafico.sh.
      executor: 'externally-controlled',
      vus: CLIENTES_AL_ARRANCAR,
      maxVUs: CLIENTES_MAXIMO,
      // Un año. Si se cumple, k6 termina y Docker lo vuelve a levantar.
      duration: '8760h',
    },
  },
  // k6 corre con --summary-mode=disabled y solo guarda las métricas que tienen un umbral. Este umbral se
  // cumple siempre: está para que k6 cuente las iteraciones y bin/trafico.sh pueda mostrarlas.
  // Sin guardar las demás, la memoria de k6 no crece aunque corra por días.
  thresholds: {
    iterations: ['count>=0'],
  },
  // k6 guarda la IP de cada nombre 5 minutos por defecto. Cuando un servicio se recrea, Docker
  // le da otra IP y la clientela seguiría llamando a la vieja durante esos 5 minutos.
  dns: {
    ttl: '10s',
  },
};

const PORCENTAJE_A_PROD = 85;

// Reparto de los recorridos, igual en los dos ambientes.
const PORCENTAJE_MIRAR = 60;
const PORCENTAJE_COMPRAR = 30; // el 10 % restante es revisar

const CATEGORIAS = ['frutas-y-verduras', 'antojitos', 'artesanias', 'abarrotes'];

// Lo que la gente busca. Las tres últimas no existen en el tianguis: dan búsquedas sin resultado.
const BUSQUEDAS = ['tamal', 'aguacate', 'limon', 'mango', 'cafe', 'rebozo', 'pizza', 'sushi', 'televisor'];

const PARAMETROS = { timeout: '10s' };
const JSON_PARAMETROS = { timeout: '10s', headers: { 'Content-Type': 'application/json' } };

// Pedidos que hizo este cliente en cada ambiente. Cada VU tiene su propia copia de esta variable.
const misPedidos = { prod: [], dev: [] };
const PEDIDOS_RECORDADOS = 10;

// Entero al azar entre minimo y maximo, los dos incluidos.
function entre(minimo, maximo) {
  return minimo + Math.floor(Math.random() * (maximo - minimo + 1));
}

function unoDe(lista) {
  return lista[Math.floor(Math.random() * lista.length)];
}

// Verdadero en ese porcentaje de las veces.
function suerte(porcentaje) {
  return Math.random() * 100 < porcentaje;
}

// Pausa de persona entre una petición y la siguiente: de 0.5 a 2 segundos.
function pausa() {
  sleep(0.5 + Math.random() * 1.5);
}

// Lista el catálogo y devuelve sus productos. Si algo falla, devuelve una lista vacía.
function listarCatalogo(ambiente) {
  const respuesta = http.get(`${ambiente.catalogo}/productos`, PARAMETROS);
  pausa();
  if (respuesta.status !== 200) {
    return [];
  }
  return respuesta.json('productos') || [];
}

function verProductos(ambiente, productos, cuantos) {
  for (let i = 0; i < cuantos && productos.length > 0; i++) {
    http.get(`${ambiente.catalogo}/productos/${unoDe(productos).sku}`, PARAMETROS);
    pausa();
  }
}

// Recorrido mirar: lista, filtra por categoría, ve de 1 a 3 productos y a veces busca.
function mirar(ambiente) {
  const productos = listarCatalogo(ambiente);

  http.get(`${ambiente.catalogo}/productos?categoria=${unoDe(CATEGORIAS)}`, PARAMETROS);
  pausa();

  verProductos(ambiente, productos, entre(1, 3));

  if (suerte(35)) {
    http.get(`${ambiente.catalogo}/productos/buscar?q=${unoDe(BUSQUEDAS)}`, PARAMETROS);
    pausa();
  }
}

// Arma las líneas de un pedido: de 1 a 4 productos con stock, 1 a 3 unidades de cada uno.
// De vez en cuando mete un error a propósito, para que haya pedidos rechazados.
function armarLineas(productos) {
  const conStock = productos.filter((producto) => producto.stock > 0);
  const lineas = [];
  const usados = {};
  const cuantas = entre(1, 4);
  for (let i = 0; i < cuantas && conStock.length > 0; i++) {
    const producto = unoDe(conStock);
    if (!usados[producto.sku]) {
      usados[producto.sku] = true;
      lineas.push({ sku: producto.sku, cantidad: entre(1, 3) });
    }
  }
  if (lineas.length === 0) {
    lineas.push({ sku: 'TNG-0001', cantidad: 1 });
  }

  if (suerte(8)) {
    // Un sku que no existe: el pedido sale rechazado por sku inexistente.
    lineas[0].sku = `TNG-9${entre(100, 999)}`;
  } else if (suerte(7)) {
    // Más unidades de las que hay: el pedido sale rechazado por falta de stock.
    lineas[0].cantidad = 5000;
  }
  return lineas;
}

function metodoDePago() {
  const sorteo = Math.random() * 100;
  if (sorteo < 60) {
    return 'tarjeta';
  }
  return sorteo < 85 ? 'oxxo' : 'spei';
}

function recordarPedido(ambiente, id) {
  const pedidos = misPedidos[ambiente.nombre];
  pedidos.push(id);
  if (pedidos.length > PEDIDOS_RECORDADOS) {
    pedidos.shift();
  }
}

// Recorrido comprar: mira un poco, crea un pedido y, si quedó confirmado (201), lo paga.
// En dev no hay pagos: el recorrido termina con el pedido creado.
function comprar(ambiente) {
  const productos = listarCatalogo(ambiente);
  verProductos(ambiente, productos, entre(1, 2));

  const cuerpo = JSON.stringify({ lineas: armarLineas(productos) });
  const pedido = http.post(`${ambiente.pedidos}/pedidos`, cuerpo, JSON_PARAMETROS);
  pausa();
  if (pedido.status !== 201 && pedido.status !== 422) {
    return; // catalogo no respondió o pedidos falló: no hay pedido
  }
  const id = pedido.json('id');
  recordarPedido(ambiente, id);
  if (pedido.status !== 201 || !ambiente.pagos) {
    return; // rechazado, o en un ambiente sin pagos: no se paga
  }

  const pago = JSON.stringify({ pedido_id: id, metodo: metodoDePago() });
  http.post(`${ambiente.pagos}/pagos`, pago, JSON_PARAMETROS);
  pausa();
}

// Recorrido revisar: consulta el estado de un pedido propio. Quien todavía no tiene ninguno
// mira la lista de pedidos.
function revisar(ambiente) {
  const pedidos = misPedidos[ambiente.nombre];
  if (pedidos.length > 0) {
    http.get(`${ambiente.pedidos}/pedidos/${unoDe(pedidos)}`, PARAMETROS);
  } else {
    http.get(`${ambiente.pedidos}/pedidos`, PARAMETROS);
  }
  pausa();
}

// Una iteración: un recorrido completo de un cliente. Primero se sortea el ambiente y después
// el recorrido, con el mismo reparto en los dos.
export default function () {
  const ambiente = suerte(PORCENTAJE_A_PROD) ? PROD : DEV;
  const sorteo = Math.random() * 100;
  if (sorteo < PORCENTAJE_MIRAR) {
    mirar(ambiente);
  } else if (sorteo < PORCENTAJE_MIRAR + PORCENTAJE_COMPRAR) {
    comprar(ambiente);
  } else {
    revisar(ambiente);
  }
}
