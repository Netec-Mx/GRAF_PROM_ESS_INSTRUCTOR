# catalogo

Primer microservicio de Tianguis Digital. Expone los productos del tianguis con su precio y
su stock. Está escrito en Python con FastAPI e instrumentado a mano con `prometheus_client`,
la librería cliente oficial de Prometheus.

El servicio `pedidos` lo consulta para precio y stock, así que esta API es un contrato.

## API

| Ruta | Qué hace |
|---|---|
| `GET /productos` | Lista todos. Filtro opcional `?categoria=`. |
| `GET /productos/{sku}` | Detalle de un producto. 404 si no existe. |
| `GET /productos/buscar?q=` | Busca por nombre, sin distinguir mayúsculas ni acentos. |
| `GET /salud` | 200 si el servicio está vivo. |
| `GET /metrics` | Métricas en formato Prometheus. |
| `/caos` | Fallas controladas. Ver [Caos](#caos). |

Un producto:

```json
{
  "sku": "TNG-0001",
  "nombre": "Aguacate Hass (kg)",
  "categoria": "frutas-y-verduras",
  "precio_mxn": "89.00",
  "stock": 40
}
```

- `precio_mxn` es **texto** con dos decimales exactos, en pesos mexicanos. Un número JSON
  perdería los ceros (`89.00` llegaría como `89.0`) y arrastraría errores de coma flotante.
- `stock` en 0 significa agotado.
- Las listas llegan como `{"total": 2, "productos": [...]}`.
- Categorías: `frutas-y-verduras`, `antojitos`, `artesanias`, `abarrotes`.
- Un sku que no existe responde 404 con `{"error": "producto_no_encontrado", "mensaje": "..."}`.
- Una categoría que no existe responde 200 con la lista vacía.
- `/productos/buscar` sin `q` responde 422.

La documentación interactiva está en `/docs`.

## Métricas

| Métrica | Tipo | Etiquetas |
|---|---|---|
| `http_server_requests_total` | counter | `method`, `route`, `status` |
| `http_server_request_duration_seconds` | histogram | `method`, `route` |
| `http_server_requests_in_flight` | gauge | ninguna |
| `catalog_products_out_of_stock` | gauge | `category` |
| `catalog_searches_without_results_total` | counter | ninguna |
| `chaos_active` | gauge | `type` |

Además salen las métricas por defecto de `prometheus_client`: `process_*` y `python_*`.

Reglas:

- **`route` es la plantilla de la ruta**, por ejemplo `/productos/{sku}`, nunca la ruta real
  `/productos/TNG-0001`. Con la ruta real habría una serie por cada sku pedido. Eso es justo lo
  que hace la falla de caos `cardinalidad` mientras está encendida.
- `chaos_active` tiene una serie por cada falla de caos, siempre: vale 1 si está encendida y 0
  si no.
- Una petición a una ruta que no existe se cuenta con `route="unmatched"`.
- Un método HTTP que no es estándar se cuenta con `method="OTHER"`.
- `/metrics`, `/salud` y `/caos` no se cuentan en las métricas HTTP.
- Buckets del histograma, en segundos: 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5.

Todas las métricas se definen en un solo archivo, `src/catalogo/metricas.py`.

## Logs

Una línea JSON por petición, por stdout:

```json
{"timestamp": "2026-10-11T20:15:02.123+00:00", "level": "info", "service": "catalogo", "method": "GET", "route": "/productos/{sku}", "status": 200, "duration_ms": 0.412, "msg": "peticion atendida"}
```

- `level` es `info` para 2xx y 3xx, `warning` para 4xx y `error` para 5xx.
- `/metrics`, `/salud` y `/caos` no generan línea de petición, para que el healthcheck y el
  scrape no tapen el tráfico real.
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
  http://localhost:8001/caos/latencia
```

```json
{"tipo":"latencia","activa":true,"restante_s":600,"parametros":{"ms":800,"jitter_ms":0,"porcentaje":100}}
```

| Tipo | Parámetros | Qué hace |
|---|---|---|
| `latencia` | `ms` 1 a 10000 (obligatorio), `jitter_ms` 0 a 5000 (0), `porcentaje` 1 a 100 (100), `ruta` | Demora `ms` más un extra al azar entre 0 y `jitter_ms`. |
| `errores` | `porcentaje` 1 a 100 (100), `status` 500, 502, 503 o 504 (500), `ruta` | Responde ese código sin atender la petición. |
| `cardinalidad` | ninguno | La etiqueta `route` lleva la ruta real (`/productos/TNG-0001`) en vez de la plantilla. |
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
- **`ruta` es una plantilla de negocio:** `/productos`, `/productos/buscar` o `/productos/{sku}`. Sin `ruta`, la falla
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

Cómo está hecho: el estado vive en `infraestructura/caos.py` y lo HTTP en `api/caos.py`.
`latencia` y `errores` entran como una dependencia de FastAPI que corre antes de cada ruta de
negocio; `/salud` y `/metrics` van en otro enrutador y no la tienen. `dominio` y `aplicacion`
no saben que el caos existe.

## Estructura

```
src/catalogo/
  dominio/          Producto y errores de dominio
  aplicacion/       casos de uso: listar, obtener por sku, buscar
  infraestructura/  repositorio en memoria, cargado desde datos/productos.json; estado del caos
  api/              rutas, middleware de métricas, middleware de logs; rutas e inyector de caos
  metricas.py       definición única de todas las métricas
  registro.py       formato JSON de los logs
  main.py           armado de la app
datos/productos.json  20 productos semilla
tests/
```

Las dependencias apuntan hacia adentro: `api` e `infraestructura` conocen a `aplicacion`, y
`aplicacion` conoce a `dominio`. El dominio no conoce FastAPI ni `prometheus_client`.

Para sumar un middleware nuevo basta una línea `app.add_middleware(...)` en `main.py`.

## Correr dentro del stack

Desde la raíz del repo, `bin/up.sh` lo construye y lo levanta con todo lo demás. Queda en
http://localhost:8001 (variable `PUERTO_CATALOGO` de `infra/.env`).

En el stack este servicio corre dos veces: `gpe-catalogo` es el ambiente prod y `gpe-catalogo-dev` el
ambiente dev, en http://localhost:8011. Es la misma imagen. En Prometheus los dos están en el job
`catalogo` y se distinguen por la etiqueta `ambiente`.

## Desarrollo

Necesita [uv](https://docs.astral.sh/uv/). uv descarga la versión de Python indicada en
`.python-version`.

```bash
cd servicios/catalogo
uv sync --locked
uv run ruff check .
uv run ruff format --check .
uv run mypy
uv run pytest
uv run python -m catalogo
```

Variables de entorno:

| Variable | Por defecto | Para qué |
|---|---|---|
| `CATALOGO_PUERTO` | `8000` | Puerto en el que escucha. |
| `CATALOGO_HOST` | `0.0.0.0` | Interfaz en la que escucha. |
| `CATALOGO_DATOS` | `datos/productos.json` | Archivo de productos. |
| `CAOS_TOKEN` | vacío | Token de `/caos`. Vacío, `/caos` no existe. En el stack sale de `infra/.env`. |
