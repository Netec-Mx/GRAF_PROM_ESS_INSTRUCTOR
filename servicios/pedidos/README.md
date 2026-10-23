# pedidos

Segundo microservicio de Tianguis Digital. Recibe pedidos, consulta el precio y el stock de
cada producto al servicio [`catalogo`](../catalogo/README.md) y guarda el pedido, confirmado o
rechazado. Está escrito en Go, solo con la librería estándar (`net/http`, `log/slog`), e
instrumentado a mano con `client_golang`, la librería cliente oficial de Prometheus para Go.

Expone la duración de sus peticiones como **histograma nativo y clásico a la vez** y el número
de líneas por pedido como **summary**, para poder comparar los tres tipos de distribución.

## API

| Ruta | Qué hace |
|---|---|
| `POST /pedidos` | Crea un pedido. |
| `GET /pedidos/{id}` | Detalle de un pedido. 404 si no existe. |
| `GET /pedidos` | Lista los pedidos guardados. Filtro opcional `?estado=`. |
| `GET /salud` | 200 si el servicio está vivo. |
| `GET /metrics` | Métricas en formato Prometheus. |
| `/caos` | Fallas controladas. Ver [Caos](#caos). |

Para crear un pedido:

```bash
curl -X POST http://localhost:8002/pedidos \
  -H 'Content-Type: application/json' \
  -d '{"lineas":[{"sku":"TNG-0001","cantidad":2},{"sku":"TNG-0002","cantidad":3}]}'
```

```json
{
  "id": "PED-000001",
  "estado": "confirmado",
  "lineas": [
    {"sku": "TNG-0001", "cantidad": 2, "nombre": "Aguacate Hass (kg)", "precio_unitario_mxn": "89.00", "subtotal_mxn": "178.00"},
    {"sku": "TNG-0002", "cantidad": 3, "nombre": "Jitomate saladet (kg)", "precio_unitario_mxn": "32.50", "subtotal_mxn": "97.50"}
  ],
  "total_mxn": "275.50",
  "creado_en": "2026-10-12T00:50:29Z"
}
```

Por cada línea, pedidos consulta `GET /productos/{sku}` a catalogo. Según lo que responda:

| Caso | Estado del pedido | Código | `result` en la métrica |
|---|---|---|---|
| Todas las líneas existen y tienen stock | `confirmado` | 201 | `confirmed` |
| Algún sku no existe | `rechazado_sku_inexistente` | 422 | `rejected_unknown_sku` |
| Alguna cantidad supera el stock | `rechazado_sin_stock` | 422 | `rejected_out_of_stock` |
| catalogo no responde o falla | no se crea | 503 | `dependency_error` |
| La solicitud está mal formada | no se crea | 400 | no se cuenta |

- Los pedidos rechazados **se guardan igual** y se pueden consultar. Traen `skus_rechazados`
  con los sku que causaron el rechazo y `total_mxn` en `"0.00"`.
- Si un pedido tiene a la vez un sku inexistente y otro sin stock, queda como
  `rechazado_sku_inexistente`.
- Pedidos **no descuenta stock**. Dos pedidos pueden confirmar las mismas unidades.
- `total_mxn`, `precio_unitario_mxn` y `subtotal_mxn` son **texto** con dos decimales exactos.
  Se calculan en centavos enteros, nunca con coma flotante: 3 × `"33.33"` da `"99.99"`.
- Una línea cuyo sku no existe no trae `nombre`, `precio_unitario_mxn` ni `subtotal_mxn`.
- Las listas llegan como `{"total": 2, "pedidos": [...]}`, del más antiguo al más nuevo.
- Un `?estado=` que no existe responde 200 con la lista vacía.
- El id es secuencial: `PED-000001`, `PED-000002`...

Límites de una solicitud: de 1 a 50 líneas, cantidad de 1 a 10000, sku de hasta 32 caracteres
(letras, dígitos y guiones) y sin sku repetidos. El cuerpo no puede pasar de 64 KB.

Los pedidos viven **en memoria**: se pierden al reiniciar el servicio, y solo se conservan los
últimos 1000. Al guardar el 1001 se descarta el más antiguo.

## Configuración

| Variable | Por defecto | Para qué |
|---|---|---|
| `CATALOGO_URL` | `http://catalogo:8000` | Dónde está el servicio catalogo. |
| `CATALOGO_TIMEOUT` | `2s` | Tiempo máximo de cada consulta a catalogo. |
| `PUERTO` | `8080` | Puerto en el que escucha. |
| `CAOS_TOKEN` | vacío | Token de `/caos`. Vacío, `/caos` no existe. En el stack sale de `infra/.env`. |

## Métricas

| Métrica | Tipo | Etiquetas |
|---|---|---|
| `http_server_requests_total` | counter | `method`, `route`, `status` |
| `http_server_request_duration_seconds` | histogram, nativo y clásico | `method`, `route` |
| `http_server_requests_in_flight` | gauge | ninguna |
| `http_client_requests_total` | counter | `peer`, `status` |
| `http_client_request_duration_seconds` | histogram, solo nativo | `peer` |
| `orders_created_total` | counter | `result` |
| `orders_lines_per_order` | summary, cuantiles 0.5, 0.9 y 0.99 | ninguna |
| `chaos_active` | gauge | `type` |

Además salen las métricas por defecto de `client_golang`: `go_*` y `process_*`.

Las tres métricas `http_server_*` se llaman igual que en catalogo. Una misma consulta sirve
para los dos servicios y se distinguen por la etiqueta `job`.

Reglas:

- **`route` es la plantilla de la ruta**, por ejemplo `/pedidos/{id}`, nunca la ruta real
  `/pedidos/PED-000001`. Sale de `Request.Pattern`, que llena el `ServeMux` de Go.
- Una petición a una ruta que no existe se cuenta con `route="unmatched"`.
- Un método HTTP que no es estándar se cuenta con `method="OTHER"`.
- `/metrics`, `/salud` y `/caos` no se cuentan en las métricas HTTP.
- `chaos_active` tiene una serie por cada falla de caos, siempre: vale 1 si está encendida y 0
  si no.
- `peer` vale `catalogo`. `status` es el código que respondió catalogo, o `error` si no hubo
  respuesta (caído, sin resolver el nombre o más lento que `CATALOGO_TIMEOUT`).
- `orders_lines_per_order` se observa una vez por cada pedido guardado, confirmado o rechazado.
  Usa la ventana por defecto de la librería, 10 minutos.

Todas las métricas se definen en un solo archivo, `internal/metricas/metricas.go`.

### Los tres tipos de distribución

| | Dónde | Cómo se consulta el percentil 95 |
|---|---|---|
| Histograma clásico | catalogo y pedidos | `histogram_quantile(0.95, sum by (le) (rate(http_server_request_duration_seconds_bucket{job="pedidos"}[5m])))` |
| Histograma nativo | pedidos | `histogram_quantile(0.95, sum(rate(http_server_request_duration_seconds{job="pedidos"}[5m])))` |
| Summary | pedidos | `orders_lines_per_order{quantile="0.9"}` (el cuantil ya viene calculado) |

- Buckets clásicos, en segundos: 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5.
- Histograma nativo: factor de bucket 1.1 (cada bucket es a lo más un 10 % más ancho que el
  anterior), hasta 160 buckets por serie.
- El histograma nativo solo viaja en el formato protobuf. Con `curl` a `/metrics` se ve la
  parte clásica; la nativa se ve consultando Prometheus.

## Logs

JSON por stdout con `log/slog`. Una línea por petición:

```json
{"time":"2026-10-12T00:50:30.062830172Z","level":"info","msg":"peticion atendida","service":"pedidos","method":"GET","route":"/pedidos/{id}","status":200,"duration_ms":0.069}
```

Y una línea extra por cada pedido guardado:

```json
{"time":"2026-10-12T00:50:30.01668963Z","level":"info","msg":"pedido creado","service":"pedidos","order_id":"PED-000002","result":"rejected_unknown_sku","lines":1,"total_mxn":"0.00"}
```

- `level` es `info` para 2xx y 3xx, `warning` para 4xx y `error` para 5xx.
- Si catalogo falla sale una línea `pedido no creado` con `result="dependency_error"` y el
  motivo en `error`.
- `/metrics`, `/salud` y `/caos` no generan línea de petición.
- Cada cambio de caos deja su propia línea, con nivel `warning`: `caos activado` (con
  `chaos_type`, `params` y, si se pidió, `duration_s`), `caos apagado` y `caos vencido`.

## Caos

Fallas controladas que se encienden y se apagan a pedido. Son la materia prima de los labs.
En clase se manejan con `bin/caos.sh`, que habla con estas rutas:

| Ruta | Qué hace |
|---|---|
| `GET /caos` | Estado de todas las fallas. |
| `PUT /caos/{tipo}` | Enciende una falla, o reemplaza la que había. Cuerpo JSON según el tipo. |
| `DELETE /caos/{tipo}` | Apaga una falla. |
| `DELETE /caos` | Apaga todas. |

```bash
curl -X PUT -H 'X-Caos-Token: tianguis-caos' -d '{"ms": 800, "duracion_s": 600}' \
  http://localhost:8002/caos/latencia
```

```json
{"tipo":"latencia","activa":true,"restante_s":600,"parametros":{"ms":800,"jitter_ms":0,"porcentaje":100}}
```

| Tipo | Parámetros | Qué hace |
|---|---|---|
| `latencia` | `ms` 1 a 10000 (obligatorio), `jitter_ms` 0 a 5000 (0), `porcentaje` 1 a 100 (100), `ruta` | Demora `ms` más un extra al azar entre 0 y `jitter_ms`. |
| `errores` | `porcentaje` 1 a 100 (100), `status` 500, 502, 503 o 504 (500), `ruta` | Responde ese código sin atender la petición. |
| `cardinalidad` | ninguno | La etiqueta `route` lleva la ruta real (`/pedidos/PED-000001`) en vez de la plantilla. |
| `memoria` | `mb_por_minuto` 1 a 200 (obligatorio) | Retiene memoria sin liberarla hasta que el sistema mata el proceso. |

Entre paréntesis va el valor por defecto. Todas aceptan además `duracion_s`, de 1 a 86400: al
cumplirse, la falla se apaga sola y lo deja en el log.

Reglas:

- **Token.** Todas las rutas piden la cabecera `X-Caos-Token` igual a la variable `CAOS_TOKEN`.
  Sin cabecera o con otro valor responden 401. La comparación tarda lo mismo acierte o no.
- **Sin token no hay caos.** Si `CAOS_TOKEN` está vacía, `/caos` no existe y responde 404.
- **Validación estricta.** Un parámetro fuera de rango, de otro tipo o que el tipo no admite
  responde 400 y no enciende nada. Un tipo que no existe responde 404. El cuerpo no puede pasar
  de 4 KB (413).
- **`ruta` es una plantilla de negocio:** `/pedidos` o `/pedidos/{id}`. Sin `ruta`, la falla
  alcanza a todas.
- **Solo en memoria.** Un reinicio del servicio apaga todas las fallas.
- **Las fallas nunca tocan `/salud`, `/metrics` ni `/caos`.** El healthcheck no se cae por
  caos. La excepción es `memoria`, que mata el proceso a propósito: Docker lo reinicia y el
  caos queda apagado.
- `/caos` no cuenta en las métricas HTTP ni deja línea de petición en el log.
- **Un intento rechazado sí deja una línea,** con nivel `warning`, `msg` `acceso a caos
  rechazado`, `method`, `route` y `status` 401. El token que mandaron no se escribe.
- Si `latencia` y `errores` están encendidas a la vez, la petición primero se demora y después
  falla.

Lo que conviene saber de cada falla:

- **`cardinalidad`.** Al apagarla, las peticiones nuevas vuelven a la plantilla. Las series que
  ya se crearon siguen saliendo en `/metrics` hasta que el servicio se reinicie: la librería
  cliente no olvida una serie por sí sola. Las peticiones a rutas que no existen siguen como
  `route="unmatched"`.
- **`memoria`.** Al apagarla, o al vencer, la memoria retenida se libera. El contenedor no
  tiene swap extra (`memswap_limit` igual a `mem_limit`), así que al llegar al límite el
  sistema lo mata de inmediato.
- **`errores`.** La respuesta es `{"error": "error_inyectado", "mensaje": "Error inyectado por caos"}`.

Lo propio de pedidos:

- `ruta=/pedidos` alcanza tanto a `POST /pedidos` como a `GET /pedidos`: la plantilla es la
  misma.
- Un pedido que recibe un error inyectado no se crea.
- Con `latencia` encendida aquí, pagos se vuelve lento sin tener ninguna falla propia: es la
  falla de dependencia del Lab 10.

Cómo está hecho: el estado y el motor de la fuga viven en `internal/caos`, y lo HTTP en
`internal/api/caos.go`. `latencia` y `errores` son un decorador que envuelve solo los handlers
de negocio, por dentro del `ServeMux`, así conocen la plantilla de la ruta. `dominio` y
`aplicacion` no importan el paquete `caos`.

## Estructura

```
cmd/pedidos/main.go   arma la app; también es el subcomando healthcheck
internal/
  dominio/            Pedido, Linea, estados, Dinero (centavos enteros) y errores
  aplicacion/         casos de uso: crear, obtener, listar. Define CatalogoPort
  infraestructura/    cliente HTTP de catalogo y repositorio en memoria
  caos/               estado de las fallas de caos y motor de la fuga de memoria
  api/                rutas, handlers, middlewares de métricas, logs y recuperación; /caos
  metricas/           definición única de todas las métricas
```

Las dependencias apuntan hacia adentro. `dominio` y `aplicacion` no importan `net/http` ni
`client_golang`; las pruebas lo cubren con un `CatalogoPort` falso.

Para sumar un middleware nuevo basta agregarlo a la lista de `api.Encadenar(...)` en `main.go`.

## Contenedor

La imagen final es `distroless` con usuario no root: no tiene shell, `curl` ni `wget`. Por eso
el healthcheck es un subcomando del propio binario:

```bash
MSYS_NO_PATHCONV=1 docker exec gpe-pedidos /pedidos healthcheck; echo $?
```

Consulta `/salud` y sale con 0 si responde 200, o con 1 si no. `MSYS_NO_PATHCONV=1` solo hace
falta en Git Bash de Windows, para que no convierta `/pedidos` en una ruta de Windows.

## Correr dentro del stack

Desde la raíz del repo, `bin/up.sh` lo construye y lo levanta con todo lo demás, después de
que catalogo está `healthy`. Queda en http://localhost:8002 (variable `PUERTO_PEDIDOS` de
`infra/.env`).

En el stack este servicio corre dos veces: `gpe-pedidos` es el ambiente prod y
`gpe-pedidos-dev` el ambiente dev, en http://localhost:8012. Es la misma imagen;
`pedidos-dev` consulta a `catalogo-dev`. En Prometheus los dos están en el job `pedidos` y se
distinguen por la etiqueta `ambiente`.

## Desarrollo

Necesita Go 1.27 y [golangci-lint](https://golangci-lint.run/) v2.

```bash
cd servicios/pedidos
go vet ./...
golangci-lint run ./...
go test -race ./...
CATALOGO_URL=http://localhost:8001 go run ./cmd/pedidos
```

Sin Go instalado, lo mismo con Docker:

```bash
docker run --rm -v "$PWD":/src -w /src golang:1.27.2 go test -race ./...
docker run --rm -v "$PWD":/src -w /src golangci/golangci-lint:v2.14.0 golangci-lint run ./...
```
