<!-- {% raw %} -->
# Consultas de la Práctica 8, resueltas

Escribe cada consulta dentro de su bloque, entre la línea `logql` y la línea que cierra el bloque. Una consulta puede ocupar varias líneas. Antes de copiarla aquí, ejecútala en Explore con Loki y revisa que devuelva datos.

`Capitulo8/verificar.sh` ejecuta cada consulta contra Loki.

## 1. Líneas de catalogo que no terminaron con status 200, con un filtro de línea

```logql
{compose_service="catalogo"} |= "peticion atendida" != `"status": 200`
```

## 2. Respuestas 5xx de catalogo, con el parser json y un filtro por campo

```logql
{compose_service="catalogo"} | json | status >= 500
```

## 3. Las mismas respuestas 5xx, mostradas con line_format como método, ruta, status y duración

```logql
{compose_service="catalogo"} | json | status >= 500 | line_format "{{.method}} {{.route}} {{.status}} {{.duration_ms}} ms"
```

## 4. Cantidad de respuestas 5xx de catalogo en el último minuto, con count_over_time

```logql
sum(count_over_time({compose_service="catalogo"} | json | status >= 500 [1m]))
```

## 5. Líneas por segundo que escribe cada servicio, con rate

```logql
sum by (compose_service) (rate({compose_service=~".+"}[1m]))
```

## 6. Respuestas de catalogo en los últimos 5 minutos, por status

```logql
sum by (status) (count_over_time({compose_service="catalogo"} | json [5m]))
```

## 7. Percentil 95 de duration_ms de catalogo por ruta, con quantile_over_time y unwrap

```logql
quantile_over_time(0.95, {compose_service="catalogo"} | json | unwrap duration_ms [5m]) by (route)
```

## 8. Líneas de pagos que tienen trace_id, filtrando por el metadato estructurado sin parser

```logql
{compose_service="pagos"} | trace_id != ""
```
<!-- {% endraw %} -->
