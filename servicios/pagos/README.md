# pagos

Tercer microservicio de Tianguis Digital. Cobra un pedido: consulta su total al servicio
[`pedidos`](../pedidos/README.md), lo pasa por una pasarela simulada y guarda el pago. Está
escrito en Java con Spring Boot y Spring MVC sobre hilos virtuales, e instrumentado con
**OpenTelemetry**.

Es el servicio distinto de los tres:

- **No tiene `/metrics` ni job de scrape.** Empuja sus métricas por OTLP directo a Prometheus.
  En Status, Targets de Prometheus no aparece y `up{job="pagos"}` no existe, pero sus métricas
  están.
- **Emite trazas**, que van por el OTel Collector a Tempo.
- Sus logs llevan `trace_id`, y sus métricas llevan exemplars con `trace_id`. Con eso se salta
  de una métrica a su traza y de la traza a sus logs.

## API

| Ruta | Qué hace |
|---|---|
| `POST /pagos` | Paga un pedido. |
| `GET /pagos/{id}` | Detalle de un pago. 404 si no existe. |
| `GET /pagos` | Lista los pagos que se conservan. Filtro opcional `?estado=`. |
| `GET /salud` | 200 si el servicio está vivo. |
| `/caos` | Fallas controladas. Ver [Caos](#caos). |

```bash
curl -X POST http://localhost:8003/pagos \
  -H 'Content-Type: application/json' \
  -d '{"pedido_id":"PED-000001","metodo":"tarjeta"}'
```

```json
{"id":"PAG-000001","pedido_id":"PED-000001","pedido_creado_en":"2026-10-12T03:40:45Z","monto_mxn":"275.50","metodo":"tarjeta","estado":"aprobado"}
```

**El monto nunca viene del cliente.** Pagos consulta `GET /pedidos/{id}` a pedidos y cobra su
`total_mxn`. Si el cuerpo trae un monto, se ignora.

| Caso | Código | Estado del pago | `error` en la respuesta |
|---|---|---|---|
| La pasarela aprueba | 201 | `aprobado` | |
| La pasarela rechaza por fondos | 402 | `rechazado` | |
| La pasarela falla | 502 | `error_pasarela` | |
| El pedido no existe | 404 | no se crea | `pedido_no_encontrado` |
| El pedido no está confirmado | 409 | no se crea | `pedido_no_confirmado` |
| El pedido ya tiene un pago aprobado | 409 | no se crea | `pedido_ya_pagado` |
| Hay otro pago del mismo pedido en curso | 409 | no se crea | `pago_en_curso` |
| pedidos no responde o falla | 503 | no se crea | `pedidos_no_disponible` |
| La solicitud está mal formada | 400 | no se crea | `solicitud_invalida` |
| El cuerpo pasa de 16 KB | 413 | no se crea | `cuerpo_demasiado_grande` |

- Con 201, 402 y 502 el pago **se guarda** y la respuesta es el pago. Un pedido con un pago
  rechazado o con error se puede volver a pagar.
- `metodo` es `tarjeta`, `oxxo` o `spei`, en minúsculas.
- `monto_mxn` es **texto** con dos decimales exactos. Por dentro es `BigDecimal`, nunca `double`.
- El id es secuencial: `PAG-000001`, `PAG-000002`...
- `pedido_creado_en` es la fecha de creación del pedido, tal como la informa pedidos. Junto
  con `pedido_id` identifica al pedido que se pagó: pedidos reusa los id al reiniciarse, así
  que el id solo no alcanza. El job `conciliacion` empareja pagos con pedidos por los dos.
- Los errores responden `{"error": "...", "mensaje": "..."}`.
- La lista llega como `{"total": 2, "pagos": [...]}`, del más antiguo al más nuevo, igual que
  en catalogo y pedidos. `?estado=` admite `aprobado`, `rechazado` o `error_pasarela`; un
  estado que no existe responde 200 con la lista vacía. La lista trae como mucho los últimos
  1000 pagos, que son los que se conservan.

Los pagos viven **en memoria** y se pierden al reiniciar el servicio. Hay dos topes distintos:

- **Pagos consultables: los últimos 1000.** Al guardar el 1001 se descarta el más antiguo y
  `GET /pagos/{id}` de ese pago responde 404.
- **Pedidos ya pagados: hasta 100 000.** Es un conjunto aparte, que **no se vacía al descartar
  pagos**. Un pedido pagado sigue respondiendo 409 `pedido_ya_pagado` aunque su pago ya no se
  pueda consultar. Recién al pasar de 100 000 pedidos pagados se olvida el más antiguo.

Un pedido se reconoce por su id **y su fecha de creación** (`creado_en`), no solo por el id.
Pedidos guarda en memoria y al reiniciarse vuelve a numerar desde `PED-000001`; sin la fecha,
pagos rechazaría como ya pagado a un pedido nuevo que reusa un id viejo.

## Pasarela simulada

No hay red: la pasarela corre dentro del proceso, espera un rato y decide al azar.

| Método | Latencia normal | Rechazo por fondos | Error |
|---|---|---|---|
| `tarjeta` | 40 a 250 ms | 7 % | 2 % |
| `oxxo` | 80 a 400 ms | no hay | 2 % |
| `spei` | 30 a 150 ms | 3 % | 1 % |

En cualquier método, **2 de cada 100 llamadas tardan entre 1 y 2 segundos**. Son las que los
exemplars dejan encontrar.

El azar y la espera se inyectan, así las pruebas unitarias son deterministas y no esperan.

## Configuración

| Variable | Por defecto | Para qué |
|---|---|---|
| `PEDIDOS_URL` | `http://pedidos:8080` | Dónde está el servicio pedidos. |
| `PEDIDOS_TIMEOUT` | `2s` | Tiempo máximo de cada consulta a pedidos. |
| `PUERTO` | `8080` | Puerto en el que escucha. |
| `CAOS_TOKEN` | vacío | Token de `/caos`. Vacío, `/caos` no existe. En el stack sale de `infra/.env`. |

El agente de OpenTelemetry se configura con variables `OTEL_*`, que están comentadas en
`infra/compose.yaml`:

| Señal | A dónde va | Protocolo |
|---|---|---|
| Trazas | OTel Collector, `otelcol:4317`, y de ahí a Tempo | OTLP gRPC |
| Métricas | Prometheus, `prometheus:9090/api/v1/otlp/v1/metrics`, sin pasar por el Collector | OTLP HTTP |
| Logs | stdout; el agente no los exporta | |

Recurso: `service.name=pagos`, `deployment.environment.name=curso` y
`service.instance.id=pagos:8080`. No lleva `service.namespace`: con ese atributo Prometheus
arma la etiqueta `job` como `namespace/nombre` y pagos quedaría como `job="tianguis/pagos"`.

## Telemetría

El **agente** de OpenTelemetry instrumenta solo, sin código: el servidor HTTP, el cliente HTTP
hacia pedidos y la JVM. Encima hay tres cosas hechas a mano con la API de OpenTelemetry:

| Qué | Nombre en OpenTelemetry | Atributos |
|---|---|---|
| Span | `pasarela.cobrar` (con `@WithSpan`) | `payment.method`, `payment.result` |
| Counter | `payments.processed` | `payment.method`, `payment.result` |
| Histogram | `payments.amount`, unidad `mxn` | `payment.method` |

`payment.result` vale `approved`, `declined` o `gateway_error`.

Las métricas manuales se definen en un solo archivo,
`src/main/java/mx/tianguis/pagos/telemetria/MetricasDePagos.java`.

### Cómo quedan los nombres en Prometheus

Los nombres van con puntos, al estilo OpenTelemetry. Al recibirlos por OTLP, Prometheus cambia
los puntos por guiones bajos y agrega los sufijos de unidad y de tipo
(`translation_strategy: UnderscoreEscapingWithSuffixes` en `infra/prometheus/prometheus.yml`).

| En OpenTelemetry | En Prometheus |
|---|---|
| `payments.processed` (counter) | `payments_processed_total` |
| `payments.amount` (histogram, `mxn`) | `payments_amount_mxn_bucket`, `_sum`, `_count` |
| `chaos.active` (gauge, sin unidad) | `chaos_active` |
| `http.server.request.duration` (histogram, `s`) | `http_server_request_duration_seconds_bucket`, `_sum`, `_count` |
| `http.client.request.duration` (histogram, `s`) | `http_client_request_duration_seconds_bucket`, `_sum`, `_count` |
| atributo `payment.method` | etiqueta `payment_method` |
| atributo `type` de `chaos.active` | etiqueta `type` |
| atributo `http.route` | etiqueta `http_route` |
| recurso `service.name` | etiqueta `job` (y también `service_name`) |
| recurso `service.instance.id` | etiqueta `instance` |

Además llegan las métricas de la JVM (`jvm_memory_used_bytes`, `jvm_gc_duration_seconds_*`,
`jvm_thread_count`...) y `target_info`, con el resto de los atributos del recurso.

`chaos_active{job="pagos"}` tiene una serie por cada falla de caos, siempre: 1 si está
encendida y 0 si no. La etiqueta es `type`, igual que en catalogo, pedidos y conciliacion; por
eso el atributo de OpenTelemetry se llama `type`, sin prefijo. La métrica no lleva unidad: con
unidad `1`, Prometheus la habría llamado `chaos_active_ratio`.

La unidad va en minúsculas a propósito. Prometheus la agrega al nombre tal como llega: con
`MXN` la métrica quedaba como `payments_amount_MXN_bucket`.

### Etiquetas HTTP: distintas de catalogo y pedidos, a propósito

`http_server_request_duration_seconds` se llama igual en los tres servicios, pero en pagos las
etiquetas siguen las **convenciones semánticas de OpenTelemetry**, porque las pone el agente:

| catalogo y pedidos (instrumentación a mano) | pagos (convenciones de OpenTelemetry) |
|---|---|
| `method` | `http_request_method` |
| `route` | `http_route` |
| `status` | `http_response_status_code` |

No se igualaron. Es parte de lo que el curso muestra: la misma métrica, instrumentada por dos
caminos, llega con etiquetas distintas, y una consulta que agrupe por `route` no ve a pagos.
Dos diferencias más: el agente marca una ruta que no existe como `http_route="/*"` y no como
`unmatched`, y sí cuenta `/salud`.

En pagos no existe `http_server_requests_total`: el número de peticiones sale de
`http_server_request_duration_seconds_count`.

Consultas de ejemplo:

```promql
sum by (payment_method, payment_result) (rate(payments_processed_total[5m]))

histogram_quantile(0.95, sum by (le) (rate(http_server_request_duration_seconds_bucket{job="pagos"}[5m])))
```

### De la métrica a la traza y a los logs

1. En Grafana, Explore, datasource Prometheus, activa **Exemplars** y consulta
   `http_server_request_duration_seconds_bucket{job="pagos", http_route="/pagos"}`.
2. Cada exemplar es una petición real, con su `trace_id`. Los de más de 1 segundo son los
   pagos lentos. El enlace "Ver traza" abre la traza en Tempo.
3. La traza muestra tres spans: `POST /pagos` (servidor), `GET` (cliente hacia pedidos) y
   `pasarela.cobrar`.
4. Desde un span, el enlace a logs abre en Loki las líneas de pagos con ese `trace_id`.

## Logs

JSON por stdout. Una línea por petición:

```json
{"timestamp":"2026-10-12T01:39:43.873Z","level":"info","service":"pagos","method":"POST","route":"/pagos","status":201,"duration_ms":1888.587,"trace_id":"76d9f67422e82c15dbe040805b61481e","span_id":"42eebcb766fd4402","msg":"peticion atendida","logger":"mx.tianguis.pagos.api.RegistroDePeticiones"}
```

Y una línea extra por cada pago que pasó por la pasarela:

```json
{"timestamp":"2026-10-12T01:39:43.872Z","level":"info","service":"pagos","payment_id":"PAG-000041","order_id":"PED-000102","method":"spei","result":"approved","amount_mxn":"341.00","trace_id":"76d9f67422e82c15dbe040805b61481e","span_id":"42eebcb766fd4402","msg":"pago procesado","logger":"mx.tianguis.pagos.api.PagosControlador"}
```

- `route` es la plantilla de la ruta, por ejemplo `/pagos/{id}`, nunca la ruta real. Una ruta
  que no existe sale como `unmatched` y un método no estándar como `OTHER`.
- `level` es `info` para 2xx y 3xx, `warning` para 4xx y `error` para 5xx.
- `/salud` y `/caos` no generan línea de petición.
- Cada cambio de caos deja su propia línea, con nivel `warning`: `caos activado` (con
  `chaos_type`, `params` y, si se pidió, `duration_s`), `caos apagado` y `caos vencido`.
- Los logs de Spring y de Tomcat salen con el mismo formato.
- Al arrancar hay dos líneas que no son JSON: un aviso de la JVM y la versión del agente. Si el
  agente no logra exportar, también lo avisa en texto plano.

## Caos

Fallas controladas que se encienden y se apagan a pedido. En clase se manejan con
`bin/caos.sh`. El contrato es el mismo que en catalogo y pedidos:

| Ruta | Qué hace |
|---|---|
| `GET /caos` | Estado de todas las fallas. |
| `PUT /caos/{tipo}` | Enciende una falla, o reemplaza la que había. Cuerpo JSON según el tipo. |
| `DELETE /caos/{tipo}` | Apaga una falla. |
| `DELETE /caos` | Apaga todas. |

| Tipo | Parámetros | Qué hace |
|---|---|---|
| `pasarela_lenta` | `ms` 100 a 10000 (obligatorio), `porcentaje` 1 a 100 (100), `metodo` | Suma `ms` a lo que tarda el cobro. |
| `pasarela_errores` | `porcentaje` 1 a 100 (100), `metodo` | El cobro termina en `error_pasarela` (502). |

Entre paréntesis va el valor por defecto. `metodo` limita la falla a `tarjeta`, `oxxo` o
`spei`; sin `metodo` alcanza a los tres. Las dos aceptan `duracion_s`, de 1 a 86400: al
cumplirse, la falla se apaga sola y lo deja en el log.

Reglas:

- **Token.** Todas las rutas piden la cabecera `X-Caos-Token` igual a la variable `CAOS_TOKEN`.
  Sin cabecera o con otro valor responden 401. Si `CAOS_TOKEN` está vacía, `/caos` no existe y
  responde 404.
- **La ruta va escrita tal cual.** `/caos;x=1`, `/%63aos` o `/caos/` responden 404. El token se
  revisa sobre el controlador que Spring eligió, no sobre el texto de la URL.
- **Validación estricta.** Un parámetro fuera de rango, de otro tipo o que el tipo no admite
  responde 400 y no enciende nada. Un tipo que no existe responde 404. El cuerpo no puede pasar
  de 4 KB (413).
- **Solo en memoria.** Un reinicio del servicio apaga todas las fallas.
- Las fallas solo tocan el cobro. `/salud`, `GET /pagos` y `/caos` no cambian.
- `/caos` no deja línea de petición en el log; cada cambio deja la suya.

Lo que conviene saber:

- **La demora queda dentro del span `pasarela.cobrar`.** Por eso un exemplar lento lleva a una
  traza donde ese span es el largo. Con `latencia` encendida en pedidos pasa lo contrario: el
  span largo es el de cliente hacia pedidos y `pasarela.cobrar` sale normal. Ese contraste es
  el Lab 10.
- La demora se suma a la latencia normal de la pasarela, que ya tiene un 2 % de cobros de
  entre 1 y 2 segundos.
- Con `pasarela_errores` el cobro falla sin llegar a la pasarela simulada. El pago se guarda
  con estado `error_pasarela` y cuenta en `payments_processed_total` como
  `payment_result="gateway_error"`.
- **`/caos` sí cuenta en las métricas HTTP de pagos,** como `http_route="/caos/{tipo}"` o
  `"/caos"`, incluidos los intentos rechazados con 401. En catalogo y pedidos `/caos` no
  cuenta. La diferencia tiene una razón: las métricas HTTP de pagos no las escribe el servicio,
  las genera el agente de OpenTelemetry para toda petición que entra, igual que con `/salud`.
  El agente no deja excluir una ruta, y filtrarla después exigiría pasar las métricas por el
  OTel Collector en vez de mandarlas directo a Prometheus. Es una decisión aceptada. Para
  dejar `/caos` fuera de una consulta: `http_route!~"/caos.*"`.
- **Un intento rechazado deja una línea de log,** con nivel `warning`, `msg` `acceso a caos
  rechazado`, `method`, `route` y `status` 401. El token que mandaron no se escribe.

Cómo está hecho: la pasarela se arma con dos decoradores de `PasarelaPort`. De afuera hacia
adentro: `PasarelaTrazada` abre el span, `PasarelaConCaos` aplica las fallas y
`PasarelaSimulada` cobra. El estado vive en `infraestructura/EstadoDeCaos`. `dominio` y
`aplicacion` no saben que el caos existe, y ArchUnit lo sigue verificando.

## Estructura

```
src/main/java/mx/tianguis/pagos/
  dominio/          Pago, MetodoPago, EstadoPago, Montos y errores de dominio
  aplicacion/       casos de uso procesar pago y obtener pago; PedidosPort y PasarelaPort
  infraestructura/  cliente HTTP de pedidos, pasarela simulada con sus decoradores (traza y
                    caos), repositorio en memoria y estado del caos
  api/              controladores, manejo de errores, logs de petición y formato JSON; /caos
  telemetria/       métricas manuales con la API de OpenTelemetry, incluida chaos.active
  Configuracion.java   arma la app
```

Las dependencias apuntan hacia adentro. `dominio` y `aplicacion` no dependen de Spring ni de
OpenTelemetry; lo verifica una prueba de ArchUnit en cada `./mvnw verify`.

Para sumar un filtro o un interceptor nuevo basta declararlo como un componente de Spring; no
hay que tocar los controladores.

## Contenedor

- Imagen final con JRE, sin JDK ni Maven, y usuario no root (uid 10001).
- JVM con `-XX:MaxRAMPercentage=55` y límite de 768 MiB: el heap llega hasta 424 MiB y quedan
  unos 344 MiB para la memoria fuera del heap, que con el agente pasa de 300 MiB.
- La descarga de Maven se verifica con el SHA-256 fijado en
  `.mvn/wrapper/maven-wrapper.properties`; si no coincide, la construcción falla. `unzip` se
  instala solo en la etapa de construcción, porque el wrapper lo necesita para usar el `.zip`
  al que corresponde ese checksum. No llega a la imagen final.
- El **agente de OpenTelemetry** se descarga en la construcción desde su release oficial de
  GitHub. El Dockerfile exige su SHA-256 (`OTEL_AGENT_SHA256` en `infra/.env`): si falta o no
  coincide, la construcción falla.
- **Healthcheck.** La imagen no trae `curl` ni `wget` y no se le agrega nada. `bash`, que ya
  viene en la imagen, abre el socket con `/dev/tcp`, pide `GET /salud` y revisa que la primera
  línea de la respuesta traiga un 200. No arranca una segunda JVM cada 10 segundos.

## Correr dentro del stack

Desde la raíz del repo, `bin/up.sh` lo construye y lo levanta después de que pedidos, el OTel
Collector y Prometheus están `healthy`. Queda en http://localhost:8003 (variable
`PUERTO_PAGOS` de `infra/.env`). La primera construcción descarga Maven y las dependencias y
tarda unos minutos.

## Desarrollo

Necesita un JDK 25. El wrapper descarga Maven 3.10.0.

```bash
cd servicios/pagos
./mvnw verify
```

`verify` compila con `-Xlint:all -Werror` y corre las pruebas unitarias y las de ArchUnit.

Sin JDK instalado, lo mismo con Docker. La imagen del JDK no trae `unzip`, que el wrapper
necesita para verificar el checksum de Maven:

```bash
docker run --rm -v "$PWD":/src -w /src eclipse-temurin:25.0.4.1_1-jdk \
  sh -c 'apt-get update -qq && apt-get install -y -qq unzip >/dev/null && ./mvnw verify'
```

Para correrlo fuera del stack, sin agente (sin trazas ni métricas):

```bash
PEDIDOS_URL=http://localhost:8002 PUERTO=8003 ./mvnw spring-boot:run
```

Al subir la versión de Maven hay que cambiar juntos `distributionUrl` y
`distributionSha256Sum` en `.mvn/wrapper/maven-wrapper.properties`. Apache publica el SHA-512
de cada distribución; el SHA-256 se calcula sobre el mismo archivo después de comprobar el
SHA-512.

Al subir la versión del agente hay que cambiar tres cosas juntas: `OTEL_AGENT_VERSION` y
`OTEL_AGENT_SHA256` en `infra/.env.example`, y las propiedades
`opentelemetry-instrumentation.version` y `opentelemetry.version` de `pom.xml`.
