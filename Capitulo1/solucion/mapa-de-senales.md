# Mapa de señales de Tianguis Digital

Estas son las dos tablas resueltas. La columna Por qué admite otras redacciones, lo que no cambia es el modelo de entrega.

## Tabla 1. Señales por componente

| Componente | Métricas | Logs | Trazas | Modelo de entrega de las métricas | Por qué |
|---|---|---|---|---|---|
| catalogo | sí | sí | no | pull | Vive todo el día y publica /metrics. Prometheus pasa cada 15 segundos y de paso sabe si el servicio contesta. |
| pedidos | sí | sí | no | pull | Igual que catalogo. Es un servicio de larga vida con /metrics, así que conviene que Prometheus vaya a buscarlo. |
| pagos | sí | sí | sí | push OTLP | No publica /metrics. El agente de OpenTelemetry empuja las métricas al receptor OTLP de Prometheus y las trazas al Collector. |
| conciliacion | sí | sí | no | Pushgateway | Cada corrida dura milisegundos y termina antes de que alguien pase a preguntar. Deja su resultado en el Pushgateway y Prometheus lo recoge de ahí. |
| k6 | no | sí | no | ninguno | Solo genera la clientela. En este stack no manda métricas a la plataforma, su efecto se mide en los servicios que reciben el tráfico. |

## Tabla 2. Comparación de herramientas

| Herramienta | Modelo de datos | Entrega | Consulta | Cuándo la elegiría |
|---|---|---|---|---|
| Prometheus | Series de tiempo con nombre de métrica y etiquetas clave y valor | Pull sobre HTTP, y además recibe push por OTLP y por escritura remota | PromQL | Para este caso. Servicios que viven todo el día, alertas sobre métricas y un solo servidor fácil de operar. |
| Graphite | Series con nombre jerárquico separado por puntos, sin etiquetas nativas en su diseño original | Push, cada aplicación manda sus datos a Carbon | Funciones de Graphite sobre rutas con comodines | Si ya existe una instalación con muchas aplicaciones que mandan en formato Graphite o StatsD y no vale la pena migrarlas. |
| InfluxDB | Mediciones con etiquetas y campos, admite varios valores por punto y valores de texto | Push, por protocolo de línea sobre HTTP o con Telegraf | InfluxQL, SQL o Flux según la versión | Para eventos con marca de tiempo irregular o con muchos campos por punto, como sensores o datos de negocio. |
| Backend compatible con OpenTelemetry | Métricas, trazas y logs con atributos de recurso y convenciones semánticas comunes | Push por OTLP, desde el SDK, un agente o el Collector | La del backend que haya detrás, por ejemplo PromQL en Prometheus o Mimir y TraceQL en Tempo | Cuando se quiere instrumentar una sola vez y poder cambiar de backend, o cuando hace falta correlacionar métricas con trazas. |
