# Consultas de la Práctica 8

Escribe cada consulta dentro de su bloque, entre la línea `logql` y la línea que cierra el bloque. Una consulta puede ocupar varias líneas. Antes de copiarla aquí, ejecútala en Explore con Loki y revisa que devuelva datos.

`Capitulo8/verificar.sh` ejecuta cada consulta contra Loki.

## 1. Líneas de catalogo que no terminaron con status 200, con un filtro de línea

```logql
```

## 2. Respuestas 5xx de catalogo, con el parser json y un filtro por campo

```logql
```

## 3. Las mismas respuestas 5xx, mostradas con line_format como método, ruta, status y duración

```logql
```

## 4. Cantidad de respuestas 5xx de catalogo en el último minuto, con count_over_time

```logql
```

## 5. Líneas por segundo que escribe cada servicio, con rate

```logql
```

## 6. Respuestas de catalogo en los últimos 5 minutos, por status

```logql
```

## 7. Percentil 95 de duration_ms de catalogo por ruta, con quantile_over_time y unwrap

```logql
```

## 8. Líneas de pagos que tienen trace_id, filtrando por el metadato estructurado sin parser

```logql
```
