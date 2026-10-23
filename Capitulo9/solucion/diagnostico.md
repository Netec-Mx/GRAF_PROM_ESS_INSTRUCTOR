# Diagnóstico de El Buen Fin, resuelto

Escribe un bloque por cada problema que encuentres. Debajo de cada título va el texto, sin
cambiar los títulos. `Capitulo9/verificar.sh` revisa cada bloque.

- En Servicio va el nombre del servicio y su ambiente, por ejemplo `catalogo-dev` o `pagos`.
- En Evidencia va un trace_id de 32 caracteres, o una consulta dentro de un bloque `promql` o
  `logql`. La consulta tiene que devolver datos en Prometheus o en Loki.
- En Síntoma y en Causa va una frase.

Si encuentras más de tres problemas, copia un bloque y cambia el número.

## Problema 1

### Servicio

pedidos, ambiente prod

### Síntoma

El p95 de pedidos en prod pasó de unos 10 ms a cerca de 2 segundos y sonó LatenciaAlta.

### Evidencia

```promql
histogram_quantile(0.95, sum by (le) (rate(http_server_request_duration_seconds_bucket{job="pedidos", ambiente="prod"}[5m])))
```

### Causa

pedidos tarda en responder por su cuenta. No tiene errores y sus dependencias responden rápido, así que la demora está dentro del servicio.

## Problema 2

### Servicio

pagos

### Síntoma

Uno de cada tres POST /pagos tarda más de 2 segundos y sonó PagosLentos.

### Evidencia

2558a4ab7a120231c0d2aee48b0ce98b

### Causa

La pasarela de pagos responde lento. En la traza, pasarela.cobrar se lleva casi todo el tiempo del pago.

## Problema 3

### Servicio

catalogo-dev

### Síntoma

catalogo en dev responde con error 500 más de la mitad de las veces y sonó ErroresAltos.

### Evidencia

```promql
sum by (status) (rate(http_server_requests_total{job="catalogo", ambiente="dev"}[5m]))
```

### Causa

catalogo-dev falla por su cuenta. Los errores de pedidos-dev son consecuencia, porque pedidos-dev le pide los productos a catalogo-dev.
