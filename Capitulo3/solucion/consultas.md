# Consultas de la Práctica 3

Consultas resueltas. Varias se pueden escribir de más de una forma correcta. Estas son las que usa la guía.

`Capitulo3/verificar.sh` ejecuta cada consulta contra Prometheus.

## 1. Peticiones de pedidos en prod que terminaron con un código 4xx

```promql
http_server_requests_total{job="pedidos", ambiente="prod", status=~"4.."}
```

## 2. Las peticiones de catalogo, escritas con el nombre de la métrica entre comillas

```promql
{"http_server_requests_total", job="catalogo"}
```

## 3. Pedidos confirmados por segundo en prod

```promql
rate(orders_created_total{job="pedidos", ambiente="prod", result="confirmed"}[5m])
```

## 4. Pedidos confirmados en prod durante la última hora

```promql
increase(orders_created_total{job="pedidos", ambiente="prod", result="confirmed"}[1h])
```

## 5. Cuántas veces volvió a cero el contador de pedidos confirmados de prod en los últimos 30 minutos

```promql
resets(orders_created_total{job="pedidos", ambiente="prod", result="confirmed"}[30m])
```

## 6. Peticiones por segundo de cada job en cada ambiente

```promql
sum by (job, ambiente) (rate(http_server_requests_total[5m]))
```

## 7. Las tres rutas más llamadas, con su job

```promql
topk(3, sum by (job, route) (rate(http_server_requests_total[5m])))
```

## 8. RED, tasa. Peticiones por segundo de pedidos en prod

```promql
sum(rate(http_server_requests_total{job="pedidos", ambiente="prod"}[5m]))
```

## 9. RED, errores. Proporción de respuestas 5xx de pedidos en prod

```promql
(sum(rate(http_server_requests_total{job="pedidos", ambiente="prod", status=~"5.."}[5m])) or vector(0))
  /
sum(rate(http_server_requests_total{job="pedidos", ambiente="prod"}[5m]))
```

## 10. RED, duración. Percentil 95 de pedidos en prod con el histograma nativo

```promql
histogram_quantile(0.95, sum(rate(http_server_request_duration_seconds{job="pedidos", ambiente="prod"}[5m])))
```

## 11. Percentil 95 de catalogo en prod con el histograma clásico

```promql
histogram_quantile(0.95, sum by (le) (rate(http_server_request_duration_seconds_bucket{job="catalogo", ambiente="prod"}[5m])))
```

## 12. Percentil 95 de pedidos en prod con el histograma clásico

```promql
histogram_quantile(0.95, sum by (le) (rate(http_server_request_duration_seconds_bucket{job="pedidos", ambiente="prod"}[5m])))
```

## 13. Percentil 90 de líneas por pedido en prod, desde el summary

```promql
orders_lines_per_order{job="pedidos", ambiente="prod", quantile="0.9"}
```

## 14. USE, utilización. Proporción de CPU ocupada

```promql
1 - avg(rate(node_cpu_seconds_total{mode="idle"}[5m]))
```

## 15. USE, memoria. Proporción de memoria disponible

```promql
node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes
```

## 16. USE, saturación. Carga del último minuto por cada núcleo

```promql
sum(node_load1) / count(node_cpu_seconds_total{mode="idle"})
```

## 17. Series que Prometheus tiene en memoria

```promql
prometheus_tsdb_head_series
```

## 18. Series de cada job, de mayor a menor

```promql
sort_desc(count by (job) ({__name__=~".+"}))
```

## 19. Las cinco métricas de catalogo con más series

```promql
topk(5, count by (__name__) ({job="catalogo"}))
```

## 20. Cuántas series de peticiones tiene cada ruta de catalogo

```promql
count by (route) (http_server_requests_total{job="catalogo", ambiente="prod"})
```
