# El stack de Tianguis Digital

Documentación técnica del stack sobre el que corren las prácticas del curso **Grafana y
Prometheus Essentials** (Netec). El índice de prácticas está en el [README](../README.md).

Todas las prácticas corren sobre una sola aplicación ficticia, **Tianguis Digital**, una tienda en
línea. Este repo trae la plataforma de observabilidad, tres microservicios (`catalogo`,
`pedidos` y `pagos`) y un job por lotes (`conciliacion`).

## Qué levanta

| Componente | Para qué | URL por defecto |
|---|---|---|
| Grafana | Dashboards y Explore | http://localhost:3000 |
| Prometheus | Métricas, receptor OTLP, exemplars, histogramas nativos | http://localhost:9090 |
| Alertmanager | Enrutado de alertas hacia correo y gpe-webhook | http://localhost:9093 |
| Loki | Logs | http://localhost:3100/ready |
| Tempo | Trazas | http://localhost:3200/ready |
| Grafana Alloy | Recoge los logs de los contenedores y los manda a Loki | http://localhost:12345 |
| OpenTelemetry Collector | Recibe OTLP, trazas a Tempo y métricas a Prometheus | gRPC `localhost:4317`, HTTP `localhost:4318` |
| node_exporter | Métricas de la máquina | http://localhost:9100/metrics |
| Pushgateway | Métricas de jobs por lotes | http://localhost:9091 |
| Mailpit | Buzón de pruebas para los correos de alerta | http://localhost:8025 |
| webhook | Receptor de webhooks de las alertas; escribe cada aviso como una línea JSON que queda en Loki ([detalle](../servicios/webhook/README.md)) | no publica puerto |
| catalogo | Microservicio de productos, en Python ([detalle](../servicios/catalogo/README.md)) | http://localhost:8001/productos |
| pedidos | Microservicio de pedidos, en Go; consulta a catalogo ([detalle](../servicios/pedidos/README.md)) | http://localhost:8002/pedidos |
| pagos | Microservicio de pagos, en Java con OpenTelemetry; consulta a pedidos ([detalle](../servicios/pagos/README.md)) | http://localhost:8003/salud |
| catalogo-dev y pedidos-dev | Los mismos catalogo y pedidos, en el ambiente dev. Ver [Ambientes](#ambientes) | http://localhost:8011/productos y http://localhost:8012/pedidos |
| k6 | La clientela: genera tráfico todo el tiempo. Ver [Tráfico](#tráfico) | no publica puerto |
| conciliacion | Job por lotes en Python; cruza pedidos con pagos cada 5 minutos y empuja sus métricas al Pushgateway ([detalle](../servicios/conciliacion/README.md)) | no publica puerto |

Todos los puertos escuchan solo en `127.0.0.1`. Las versiones exactas están en `infra/.env.example`.

## Requisitos

- Docker Desktop con Docker Compose v2 (macOS o Windows).
- En Windows, **Git Bash** para correr los scripts.
- Unos 3 GB de RAM libres para Docker.
- No hace falta instalar Python, Go, Java, jq ni nada más.

## Cómo levantar

```bash
bin/up.sh
```

La primera vez crea `infra/.env` a partir de `infra/.env.example`, revisa que los puertos estén
libres, descarga las imágenes, construye los microservicios, levanta todo y espera a que cada servicio esté `healthy`.
Al terminar imprime la tabla de servicios con sus URL.

Grafana entra con el usuario y contraseña de `infra/.env` (`admin` / `tianguis` por defecto).
Además arranca con el feature toggle `suggestedDashboards` encendido, que en Grafana 13.2 viene
apagado. Es el que muestra **From suggestions** en el botón **Build a dashboard** de cada
datasource y lo usa la Práctica 4.
Su correo, el de Grafana Alerting, sale por SMTP hacia Mailpit igual que el de Alertmanager.

## Ver el estado

```bash
bin/estado.sh
```

## Cómo bajar

```bash
bin/down.sh
```

Baja los contenedores y **conserva los datos**. Con `bin/up.sh` todo vuelve como estaba.

## Empezar de cero

```bash
bin/reset.sh
```

Borra los volúmenes del proyecto: métricas, logs, trazas y todo lo hecho a mano en Grafana.
No hay vuelta atrás. Pide escribir `SI` para confirmar.

## Corrida completa de las prácticas

```bash
bin/corrida-completa.sh
```

Corre las nueve prácticas una tras otra, como las haría un alumno. Para cada una corre
`preparar.sh`, aplica la solución con `solucion/aplicar.sh`, corre `verificar.sh`, que tiene que
quedar todo en verde, y `restaurar.sh`. Después revisa que `bin/estado.sh` y los archivos del
repositorio queden igual que al empezar. Si una práctica falla, se detiene y dice en cuál y en
qué paso. Al final muestra una tabla con el tiempo de cada paso y la RAM máxima del stack.

Pisa los archivos de trabajo de todas las prácticas y pide escribir `SI`. Tarda unos 30 minutos en macOS y unos 40 en Windows.
Con `bin/corrida-completa.sh 5` empieza en la Práctica 5 y con `bin/corrida-completa.sh 3 4`
corre solo la 3 y la 4. El registro completo queda en `corrida/`, que git ignora. Para partir de
un stack recién creado, corre antes `bin/reset.sh`.

## Correr una conciliación a mano

```bash
bin/conciliar.sh
```

Le pide al planificador una corrida en el momento, sin esperar los 5 minutos. Muestra el
resultado y sale con código 0 si la corrida fue exitosa o 1 si falló.

## Tráfico

La tienda tiene clientela desde que el stack levanta. La genera Grafana k6, en el contenedor
`gpe-k6`, con el script [`servicios/trafico/trafico.js`](../servicios/trafico/README.md). El
nivel se cambia en vivo, sin reiniciar nada:

```bash
bin/trafico.sh estado            # clientes actuales, si está pausado e iteraciones
bin/trafico.sh nivel alto        # bajo (2 clientes), normal (5), alto (20) o buenfin (40)
bin/trafico.sh nivel 12          # un número exacto, de 1 a 60
bin/trafico.sh pausar            # la tienda queda sin clientes
bin/trafico.sh reanudar
```

- Al levantar el stack, o si `gpe-k6` se reinicia, el nivel vuelve a `normal`.
- Cada cliente hace una petición cada 0.5 a 2 segundos. Con 5 clientes los servicios atienden
  unas 4 peticiones por segundo entre todos; con 40, unas 38.
- De cada 100 recorridos, 85 van a prod y 15 a dev. En prod, 60 miran el catálogo, 30 compran y
  pagan, y 10 revisan un pedido. En dev el reparto es el mismo, pero la compra termina en el
  pedido, sin pagar, porque dev no tiene pagos.
- Para dejar un panel en cero a propósito: `bin/trafico.sh pausar`.

## Ambientes

catalogo y pedidos corren dos veces: una como ambiente **prod** y otra como ambiente **dev**.
Son las mismas imágenes en contenedores distintos. Sirve para armar dashboards con una
variable de ambiente.

| | prod | dev |
|---|---|---|
| catalogo | `gpe-catalogo`, puerto 8001 | `gpe-catalogo-dev`, puerto 8011 |
| pedidos | `gpe-pedidos`, puerto 8002 | `gpe-pedidos-dev`, puerto 8012 |

- **En Prometheus el job se llama igual en los dos ambientes** (`catalogo` y `pedidos`). Lo que
  los distingue es la etiqueta `ambiente`, con valor `prod` o `dev`:
  `rate(http_server_requests_total{job="catalogo", ambiente="dev"}[5m])`.
- **Solo esos cuatro contenedores tienen la etiqueta `ambiente`.** pagos, conciliacion y toda
  la infraestructura existen una sola vez y no la llevan. Una consulta que filtre por
  `ambiente="prod"` no trae a pagos.
- **En Loki pasa lo mismo:** `{ambiente="dev"}` trae los logs de `catalogo-dev` y
  `pedidos-dev`, y nada más.
- pedidos-dev consulta a catalogo-dev. conciliacion mira solo prod.
- El caos también es por ambiente: `bin/caos.sh catalogo-dev errores porcentaje=50` rompe dev
  y deja prod intacto.

## Caos

`bin/caos.sh` enciende y apaga fallas controladas en los cuatro componentes de Tianguis
Digital. Es la materia prima de los labs.

```bash
bin/caos.sh estado                          # tabla de todas las fallas
bin/caos.sh pedidos latencia ms=800 jitter_ms=200 porcentaje=100 duracion_s=600
bin/caos.sh catalogo cardinalidad
bin/caos.sh pagos pasarela_lenta ms=1500 porcentaje=30
bin/caos.sh conciliacion fallar duracion_s=900
bin/caos.sh pedidos latencia off            # apaga una
bin/caos.sh apagar                          # apaga todo en los cuatro
```

| Falla | Dónde | Qué hace | Lab |
|---|---|---|---|
| `latencia` | catalogo, pedidos | Demora las peticiones de negocio. | 03, 05 |
| `errores` | catalogo, pedidos | Responde 500, 502, 503 o 504 a una parte de las peticiones. | 05, 08 |
| `cardinalidad` | catalogo, pedidos | La etiqueta `route` lleva la ruta real y crea una serie por cada una. | 04 |
| `memoria` | catalogo, pedidos | Fuga de memoria hasta que el sistema mata el contenedor. | reserva R1 |
| `pasarela_lenta` | pagos | Demora el cobro, dentro del span `pasarela.cobrar`. | 10 |
| `pasarela_errores` | pagos | El cobro termina en error de pasarela (502). | 08 |
| `fallar` | conciliacion | Cada corrida falla a propósito. | 07 |

- Todas aceptan `duracion_s`: al cumplirse, la falla se apaga sola.
- `bin/caos.sh` sin argumentos muestra los parámetros de cada falla. El detalle está en el
  README de cada servicio.
- **Un reinicio apaga todo.** El estado del caos vive solo en memoria.
- **Dos fallas no necesitan falla nueva.** La de dependencia: con `latencia` en pedidos, pagos
  se vuelve lento sin tener nada propio. El target caído: `docker stop gpe-catalogo`, y después
  `docker start gpe-catalogo`.
- Cada servicio publica `chaos_active{type="..."}`, con una serie por falla: 1 encendida, 0
  apagada. Sirve para anotar los paneles de Grafana.
- `catalogo-dev` y `pedidos-dev` aceptan las mismas fallas que catalogo y pedidos.
- Las fallas nunca tocan `/salud`, `/metrics` ni `/caos`, así que `bin/estado.sh` sigue en
  verde. La excepción es `memoria`, que mata el proceso a propósito; Docker lo reinicia solo.
- El caos pide un token, `CAOS_TOKEN` en `infra/.env`. Es un token de curso, no un secreto: el
  stack solo escucha en `127.0.0.1`. Si lo dejas vacío y corres `bin/up.sh`, el caos queda
  deshabilitado en los cuatro.

## Si un puerto está ocupado

`bin/up.sh` se detiene y dice qué puerto es y quién lo usa. Cambia el valor de ese puerto en
`infra/.env` (por ejemplo `PUERTO_GRAFANA=3001`) y vuelve a correr `bin/up.sh`.
Nunca uses 5432 ni 8081.

## Recargar la configuración de Prometheus

Después de editar `infra/prometheus/prometheus.yml` o las reglas:

```bash
docker exec gpe-prometheus kill -HUP 1
```

Para validar antes de recargar, `promtool` viene dentro del contenedor. `MSYS_NO_PATHCONV=1`
solo hace falta en Git Bash, para que no convierta la ruta en una de Windows:

```bash
MSYS_NO_PATHCONV=1 docker exec gpe-prometheus promtool check config /etc/prometheus/prometheus.yml
```

La carpeta `infra/prometheus` completa está montada en `/etc/prometheus`. Se monta la carpeta
y no el archivo suelto porque muchos editores guardan creando un archivo nuevo y renombrándolo,
y con el archivo suelto el contenedor se queda mirando el anterior. Alertmanager, Loki, Tempo,
Alloy y el Collector montan su carpeta de `infra/` por la misma razón.

No uses `docker kill -s HUP gpe-prometheus`: recarga igual, pero Docker deja de reiniciar ese
contenedor solo hasta que vuelvas a correr `bin/up.sh`.

`bin/up.sh` no recarga Prometheus. Si actualizas el repo con el stack arriba y cambió
`prometheus.yml` (por ejemplo, porque se sumó un microservicio), corre la recarga a mano.

Con Alloy pasa lo mismo si cambió `infra/alloy/config.alloy`. Se recarga así:

```bash
curl -X POST http://localhost:12345/-/reload
```

## Cómo llegan las señales

| Servicio | Métricas | Trazas | Logs |
|---|---|---|---|
| catalogo | Prometheus las recoge de `/metrics` (scrape) | no tiene | stdout, Alloy, Loki |
| pedidos | Prometheus las recoge de `/metrics` (scrape) | no tiene | stdout, Alloy, Loki |
| pagos | las empuja por OTLP directo a Prometheus | OTLP al OTel Collector, que las manda a Tempo | stdout, Alloy, Loki |
| conciliacion | cada corrida las empuja al Pushgateway, y Prometheus las recoge de ahí | no tiene | stdout, Alloy, Loki |

`pagos` no tiene `/metrics` ni job de scrape: no aparece en Status, Targets de Prometheus y
`up{job="pagos"}` no existe. Sus métricas igual están, con `job="pagos"`.

`conciliacion` tampoco tiene `up`: cada corrida dura milisegundos y muere antes de que nadie
la pueda raspar. Si el job deja de correr, sus métricas siguen en el Pushgateway con el último
valor y nada se pone en rojo. Lo único que lo delata es
`time() - conciliacion_last_success_timestamp_seconds`, que no para de crecer.

En Grafana los tres datasources quedan enlazados sin configurar nada a mano:

- **Métrica a traza.** En Explore, con Prometheus y los exemplars activados, cada punto abre su
  traza en Tempo.
- **Log a traza.** En Loki, una línea con `trace_id` trae el enlace "Ver traza".
- **Traza a logs y a métricas.** En Tempo, cada span enlaza con los logs de esa traza en Loki
  y con las métricas de su servicio en Prometheus.

## Notas

- La contraseña de admin de Grafana se toma de `infra/.env` solo la primera vez que se crea su
  volumen. Para cambiarla después, hazlo desde Grafana o corre `bin/reset.sh`.
- Los contenedores se llaman `gpe-<servicio>`, por ejemplo `gpe-prometheus` o `gpe-grafana`.
- Si un contenedor se cae, Docker lo reinicia solo. Con `bin/down.sh` el stack queda abajo
  hasta el siguiente `bin/up.sh`.
- Alloy solo recoge logs de los contenedores de este proyecto de Compose (`gpe`).
- node_exporter corre dentro de un contenedor, así que en Docker Desktop reporta la máquina
  virtual de Docker, no el sistema anfitrión.

## Estructura

```
README.md       índice de las prácticas
Capitulo1..9/   una práctica por capítulo: guía del alumno, preparar.sh, verificar.sh y
                restaurar.sh
images/         capturas y diagramas de cada práctica, y los íconos de navegación
_comun/         lib-practicas.sh, las funciones que usan los scripts de las prácticas
bin/            scripts para levantar, bajar, ver estado, resetear, conciliar a mano, caos y tráfico
infra/          compose.yaml y la configuración de cada componente
servicios/      catalogo, pedidos, pagos, el job conciliacion y el script de tráfico de k6
docs/           este documento
```

## Material del instructor

Cada capítulo trae además `RELATOR.md`, la guía del relator, y `solucion/`, con la práctica
resuelta y su `aplicar.sh`. `bin/corrida-completa.sh` corre las nueve prácticas resueltas.

## Herramientas de autor

El alumno no las necesita. Sirven para regenerar las imágenes de las guías y piden Node 22 o
superior. Están en `tools/` y el detalle está en [tools/README.md](../tools/README.md).

```bash
tools/capturas/capturar.sh 2     # recorre la práctica 2 en el stack real y escribe images/2/*.png
```
