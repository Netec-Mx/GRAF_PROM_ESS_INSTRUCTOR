# conciliacion

Job por lotes de Tianguis Digital. Cada 5 minutos cruza los pedidos confirmados con los pagos
y empuja el resultado al **Pushgateway**. Está escrito en Python, con `prometheus_client` y la
librería estándar.

No es un servicio: no escucha en ningún puerto. Cada corrida **nace, trabaja, empuja sus
métricas y muere** en unos milisegundos, antes de que Prometheus la pueda raspar. Ese es el
único caso en el que corresponde usar un Pushgateway.

## Qué concilia

En cada corrida:

1. Trae los pedidos confirmados: `GET /pedidos?estado=confirmado` a pedidos.
2. Trae los pagos: `GET /pagos` a pagos.
3. Se queda con los pedidos creados dentro de la [ventana](#la-ventana) y con los pagos de
   esos pedidos.
4. Calcula cuatro cosas:

| Qué | Cómo |
|---|---|
| Pedidos confirmados revisados | Cuántos pedidos confirmados hay en la ventana. |
| Pedidos sin pago | Los de la ventana que no tienen ningún pago `aprobado`. |
| Montos que no coinciden | Los pagos `aprobado` cuyo monto difiere del total de su pedido. |
| Monto total aprobado | La suma de los pagos `aprobado` de los pedidos de la ventana, en pesos. |

- **Un pago es de un pedido si coinciden el id y la fecha de creación:** `pedido_id` y
  `pedido_creado_en` del pago contra `id` y `creado_en` del pedido. El id solo no alcanza,
  porque pedidos guarda en memoria y al reiniciarse vuelve a numerar desde `PED-000001`. Un
  pago viejo no paga a un pedido nuevo que reusa su id.
- Los montos llegan como texto con dos decimales y se suman con `Decimal`, nunca con `float`.
- Un pago `rechazado` o `error_pasarela` no paga el pedido ni se compara con su total.
- Si un pago aprobado es de un pedido que no está entre los confirmados, suma al monto
  aprobado pero no se compara: no hay total contra el cual compararlo.
- **Si pedidos o pagos no responden, la corrida falla.** También falla si responden algo que
  no se puede usar:
  - algo que no es HTTP válido o un JSON que no se puede leer;
  - un `total` que no es un número entero igual al largo de la lista. Una respuesta que dice
    `{"total": 5, "pedidos": []}` está truncada o mal armada; aceptarla como "no hay pedidos"
    daría una corrida exitosa con datos falsos;
  - un pedido o un pago sin id, con un monto que no sea texto con dos decimales, o con una
    fecha de creación que no sea una fecha con zona horaria.
- **Ante cualquier error que nadie previó, la corrida igual se publica como fallida.**
  `__main__.py` tiene una red: atrapa la excepción, la deja en el log como JSON, empuja la
  falla con pushadd y sale con código 1. Sin esa red el proceso moriría sin empujar nada y
  `conciliacion_last_run_success` se quedaría en 1 con el job roto.

### La ventana

Cada corrida concilia solo los pedidos confirmados creados **entre hace 15 minutos y hace 1
minuto**. Son las variables `CONCILIACION_VENTANA_S` (900) y `CONCILIACION_GRACIA_S` (60).

```
        hace 15 min                                   hace 1 min     ahora
  ───────────┼─────────────────────────────────────────────┼───────────┼──▶
   muy viejo │        se concilia                          │ muy nuevo │
```

Sin la ventana, `conciliacion_orders_unpaid` contaba pedidos que no tenían nada malo:

- **Pedidos muy nuevos.** El cliente crea el pedido y tarda unos segundos en pagarlo. Si la
  corrida cae justo en medio, ese pedido aparece sin pago aunque el pago llegue enseguida.
  La gracia de 1 minuto lo deja fuera hasta la corrida siguiente.
- **Pedidos muy viejos.** pedidos y pagos guardan en memoria y conservan solo los últimos
  1000 de cada uno. pagos guarda también los cobros rechazados, así que se le llena antes: el
  pago de un pedido viejo desaparece mientras el pedido sigue en la lista, y ese pedido
  aparecía sin pago aunque se había pagado. Con tráfico, el número crecía solo.

Con la ventana, un pedido sin pago es un pedido que de verdad no se pagó: la pasarela lo
rechazó o falló.

- Los dos bordes entran: un pedido creado hace exactamente 60 o exactamente 900 segundos se
  concilia.
- Los pagos se eligen por la fecha de creación de su pedido (`pedido_creado_en`), no por la
  hora del pago. Así los cuatro números de una corrida hablan de los mismos pedidos.
- La ventana se fija cuando empieza la corrida.
- **La ventana dura más que el intervalo entre corridas** (15 minutos contra 5), así que cada
  pedido se revisa en unas tres corridas seguidas. Las métricas son una foto de los últimos
  15 minutos, no un acumulado: no se suman entre corridas.
- **Límite que queda.** La ventana supone que pagos no llega a descartar un pago en 15
  minutos. Con el tráfico normal del stack, unos 0.2 pagos por segundo, sus 1000 pagos cubren
  más de una hora. En el nivel `buenfin`, con 1.8 por segundo, cubren unos 9 minutos: ahí
  vuelven a aparecer pedidos sin pago que sí se pagaron, salvo que se acorte la ventana.
- Después de un reinicio de pedidos, los pedidos que se perdieron ya no se revisan, y sus
  pagos dejan de sumar al monto aprobado cuando salen de la ventana.

## Métricas

Se empujan al Pushgateway en el grupo `job="conciliacion"`. Prometheus las recoge con su job
`pushgateway`, que ya tiene `honor_labels: true`; por eso conservan `job="conciliacion"`.

| Métrica | Tipo | Qué es |
|---|---|---|
| `conciliacion_last_success_timestamp_seconds` | gauge | Unix time de la última corrida exitosa. |
| `conciliacion_last_run_timestamp_seconds` | gauge | Unix time de la última corrida, exitosa o no. |
| `conciliacion_last_run_success` | gauge | 1 si la última corrida fue exitosa, 0 si falló. |
| `conciliacion_last_run_duration_seconds` | gauge | Duración de la última corrida. |
| `conciliacion_orders_checked` | gauge | Pedidos confirmados de la ventana. |
| `conciliacion_orders_unpaid` | gauge | Pedidos de la ventana sin pago aprobado. |
| `conciliacion_amount_mismatches` | gauge | Pagos aprobados con monto distinto al total del pedido. |
| `conciliacion_approved_amount_mxn` | gauge | Monto aprobado de los pedidos de la ventana, en pesos. |
| `chaos_active` | gauge, etiqueta `type` | 1 si la falla de caos `fallar` está encendida. Ver [Caos](#caos). |

El Pushgateway agrega por su cuenta `push_time_seconds` y `push_failure_time_seconds` al grupo.

Todas se definen en un solo archivo,
`src/conciliacion/infraestructura/publicador_pushgateway.py`.

### push y pushadd: por qué una falla no usa push

El Pushgateway acepta dos formas de empujar un grupo:

| | Método HTTP | Qué hace con el grupo |
|---|---|---|
| **push** | `PUT` | Lo **reemplaza completo**. Lo que no venga en este envío se borra. |
| **pushadd** | `POST` | Reemplaza **solo las métricas que vienen** en este envío. Las demás quedan como estaban. |

Este job usa las dos, a propósito:

- **Corrida exitosa: push, con las 8 métricas** (más `chaos_active`). El grupo queda con el retrato completo de
  esa corrida.
- **Corrida fallida: pushadd, y solo con 3 métricas:** `conciliacion_last_run_timestamp_seconds`,
  `conciliacion_last_run_success` en 0 y `conciliacion_last_run_duration_seconds`.

Así `conciliacion_last_success_timestamp_seconds` conserva la hora de la última vez que la
corrida salió bien, y también quedan los conteos de esa corrida.

**Si en la falla se usara push, se borraría el timestamp de éxito.** El grupo quedaría solo
con las 3 métricas de la falla, `conciliacion_last_success_timestamp_seconds` dejaría de
existir, y la alerta de "no corre bien hace X" quedaría ciega: una expresión como
`time() - conciliacion_last_success_timestamp_seconds > 900` no devuelve nada cuando la serie
no existe, y una alerta sin resultado no dispara. El job estaría fallando y la alerta, callada.

### La falla silenciosa

`conciliacion` no tiene `up`. Si el planificador se detiene:

- Sus métricas **siguen en el Pushgateway**, congeladas en el último valor, y Prometheus las
  sigue recogiendo cada 15 segundos como si nada.
- `conciliacion_last_run_success` sigue en 1. `conciliacion_orders_unpaid` sigue igual.
- `up{job="pushgateway"}` sigue en 1, porque el Pushgateway está perfecto.

Lo único que cambia es la edad del último éxito:

```promql
time() - conciliacion_last_success_timestamp_seconds
```

Con el job sano oscila entre 0 y 300 segundos. Con el job detenido crece sin parar.

## Planificación

El contenedor `gpe-conciliacion` corre `python -m conciliacion.planificador`:

- Espera 30 segundos y lanza la primera corrida.
- Después lanza una corrida cada `CONCILIACION_INTERVALO` segundos, 300 por defecto.
- Cada corrida es un **proceso nuevo**, `python -m conciliacion`, y el planificador espera a
  que termine. Si una corrida falla, el planificador sigue.

### Corrida a mano

```bash
bin/conciliar.sh
```

No lanza un contenedor aparte. Le manda la señal `SIGUSR1` al planificador:

```bash
docker exec gpe-conciliacion sh -c 'kill -USR1 1'
```

El planificador lanza una corrida en el momento, sin mover la hora de la siguiente planificada.
El script espera a que termine, muestra sus líneas leyendo el log del contenedor y sale con 0
si la corrida fue exitosa o con 1 si falló.

- **Sus logs llegan a Loki,** porque la corrida sale del mismo contenedor que Alloy ya está
  leyendo. Llevan `"trigger": "manual"`; las planificadas llevan `"trigger": "scheduled"`.
- **Si ya hay una corrida en curso, la señal se ignora** y el planificador lo anota:
  `corrida manual ignorada: ya habia una corrida en curso`. El script muestra entonces el
  resultado de la corrida que estaba en marcha.
- Una corrida a mano tarda hasta un cuarto de segundo en arrancar: el planificador revisa si
  llegó una señal cada 0.25 s.
- Si el contenedor está detenido, el script se detiene y lo dice. Una corrida suelta, sin
  planificador, sigue siendo posible con `python -m conciliacion`, y lleva `"trigger": "direct"`.

### Healthcheck

El contenedor no tiene puerto que consultar. El planificador toca un **archivo de latido**
cada 5 segundos mientras espera y después de cada corrida. El healthcheck corre
`python -m conciliacion.latido`, que sale con 0 si el archivo se tocó hace menos de dos
intervalos y con 1 si no. Usa el mismo Python de la imagen, sin herramientas extra.

El healthcheck dice que el planificador está vivo. **No dice que las corridas salgan bien:**
con pedidos caído el contenedor sigue `healthy` y cada corrida falla. Para eso están las
métricas.

## Caos

conciliacion tiene una sola falla, `fallar`: mientras esté encendida, cada corrida falla a
propósito con un error de dependencia simulado. Es el caso del Lab 07: el job corre, pero no
sale bien.

```bash
bin/caos.sh conciliacion fallar                  # la enciende
bin/caos.sh conciliacion fallar duracion_s=900   # se apaga sola a los 15 minutos
bin/caos.sh conciliacion fallar off              # la apaga
```

La corrida fallida es una falla normal: sale con código 1, hace su pushadd con
`conciliacion_last_run_success 0` y deja su línea `conciliacion fallida`, con el motivo
`pedidos no respondió: falla simulada por caos`. No llama a pedidos ni a pagos. El timestamp
de último éxito no cambia.

Cómo funciona:

- conciliacion no tiene HTTP, así que no hay `/caos`. La falla es un **archivo de bandera**
  dentro del contenedor (`CONCILIACION_BANDERA_DE_CAOS`, por defecto `/tmp/conciliacion.caos`).
  Mientras el archivo exista, la falla está encendida.
- `bin/caos.sh` crea y borra la bandera con `docker exec gpe-conciliacion python -m
  conciliacion.caos ...`. Ese comando imprime el estado en JSON, con la misma forma que
  `GET /caos` en los otros servicios.
- Con `duracion_s`, de 1 a 86400, la hora de vencimiento se guarda dentro de la bandera.
  Vencida, se ignora y se borra.
- **Un reinicio apaga la falla:** el planificador borra la bandera al arrancar.
- **Sin token no hay caos,** igual que en los otros servicios: si el contenedor arrancó con
  `CAOS_TOKEN` vacío, la bandera no se puede encender y se ignora aunque alguien cree el
  archivo a mano.
- La falla no espera a la siguiente corrida: para verla en el momento, enciéndela y corre
  `bin/conciliar.sh`.

`chaos_active{type="fallar"}` vale 1 con la falla encendida y 0 si no. El planificador revisa
la bandera cada segundo: cuando cambia, deja una línea en el log (`caos activado`, `caos
apagado` o `caos vencido`) y actualiza la métrica en el Pushgateway con un pushadd que solo
lleva esa métrica. El push de una corrida exitosa también la incluye, porque ese push reemplaza
el grupo entero. El pushadd de una corrida fallida sigue llevando solo sus 3 métricas.

Cómo está hecho: la bandera y el decorador `PedidosConCaos`, que envuelve a `PedidosPort`,
viven en `infraestructura/caos.py`. `dominio` y `aplicacion` no saben que el caos existe.

## Configuración

| Variable | Por defecto | Para qué |
|---|---|---|
| `PEDIDOS_URL` | `http://pedidos:8080` | Dónde está pedidos. |
| `PAGOS_URL` | `http://pagos:8080` | Dónde está pagos. |
| `PUSHGATEWAY_URL` | `http://pushgateway:9091` | Dónde está el Pushgateway. |
| `CONCILIACION_INTERVALO` | `300` | Segundos entre corridas. Está en `infra/.env`. |
| `CONCILIACION_PRIMERA_ESPERA` | `30` | Segundos antes de la primera corrida. |
| `CONCILIACION_VENTANA_S` | `900` | Se concilian los pedidos creados desde hace estos segundos. Está en `infra/.env`. |
| `CONCILIACION_GRACIA_S` | `60` | No se concilian los pedidos creados hace menos de estos segundos. Debe ser menor que la ventana. Está en `infra/.env`. |
| `CONCILIACION_TIMEOUT` | `5` | Segundos máximos de cada llamada HTTP. |
| `CONCILIACION_LATIDO` | `/tmp/conciliacion.latido` | Archivo de latido. |
| `CONCILIACION_BANDERA_DE_CAOS` | `/tmp/conciliacion.caos` | Archivo de bandera de la falla de caos. |
| `CAOS_TOKEN` | vacío | Vacío, el caos queda deshabilitado. En el stack sale de `infra/.env`. |

## Logs

JSON por stdout. Dos líneas por corrida, con el mismo `run_id`:

```json
{"timestamp": "2026-10-12T03:40:51.551+00:00", "level": "info", "service": "conciliacion", "run_id": "9c293d3f253f", "trigger": "manual", "msg": "conciliacion iniciada"}
{"timestamp": "2026-10-12T03:40:51.571+00:00", "level": "info", "service": "conciliacion", "run_id": "9c293d3f253f", "trigger": "manual", "result": "success", "duration_ms": 13.052, "orders_checked": 30, "orders_unpaid": 10, "amount_mismatches": 0, "approved_amount_mxn": "1479.00", "msg": "conciliacion terminada"}
```

Una corrida fallida termina con `level` `error`, `result` `failure` y el motivo en `error`:

```json
{"timestamp": "2026-10-12T03:41:20.708+00:00", "level": "error", "service": "conciliacion", "run_id": "993238cfd8dd", "trigger": "manual", "result": "failure", "duration_ms": 20.855, "error": "pedidos no respondió bien: URLError: <urlopen error [Errno -2] Name or service not known>", "msg": "conciliacion fallida"}
```

`trigger` dice quién pidió la corrida: `scheduled` (el planificador), `manual`
(`bin/conciliar.sh`) o `direct` (alguien corrió `python -m conciliacion`). En Loki, las
corridas a mano que fallaron:

```logql
{compose_service="conciliacion"} | json | trigger="manual" | result="failure"
```

## Estructura

```
src/conciliacion/
  dominio/          reglas de conciliación puras, sin red
  aplicacion/       caso de uso conciliar; PedidosPort, PagosPort y PublicadorPort
  infraestructura/  clientes HTTP de pedidos y pagos, publicador al Pushgateway y caos
  __main__.py       una corrida y termina, con código de salida 0 o 1
  planificador.py   bucle que lanza una corrida como proceso nuevo cada intervalo
  caos.py           enciende y apaga la falla de caos; lo usa bin/caos.sh
  latido.py         archivo de latido y chequeo de salud
  configuracion.py  variables de entorno
  registro.py       formato JSON de los logs
tests/
```

Las dependencias apuntan hacia adentro: `infraestructura` conoce a `aplicacion`, y
`aplicacion` conoce a `dominio`. El dominio no conoce `prometheus_client` ni HTTP.

### Por qué la librería estándar y no httpx2

El job hace dos `GET` por corrida. Con `urllib` de la librería estándar la imagen instala una
sola dependencia, `prometheus_client`, y su entorno virtual pesa 1 MB. Agregar `httpx2` suma
2.3 MB y seis paquetes más (`httpcore2`, `h11`, `anyio`, `idna`, `truststore` y
`typing_extensions`), más del doble de lo que hay, para dos llamadas que no necesitan
conexiones persistentes, HTTP/2 ni asincronía. El grueso de la imagen es Python.

## Desarrollo

Necesita [uv](https://docs.astral.sh/uv/). uv descarga la versión de Python indicada en
`.python-version`.

```bash
cd servicios/conciliacion
uv sync --locked
uv run ruff check .
uv run ruff format --check .
uv run mypy
uv run pytest
```

Para una corrida fuera del contenedor, con el stack arriba:

```bash
PEDIDOS_URL=http://localhost:8002 PAGOS_URL=http://localhost:8003 \
  PUSHGATEWAY_URL=http://localhost:9091 uv run python -m conciliacion; echo $?
```
