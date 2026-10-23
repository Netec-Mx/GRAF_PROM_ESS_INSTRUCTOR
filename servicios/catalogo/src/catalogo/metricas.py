"""Definición única de todas las métricas del servicio.

Se registran en el registro por defecto de prometheus_client, que además trae las
métricas de proceso y de plataforma (process_*, python_*).
"""

from prometheus_client import Counter, Gauge, Histogram

BUCKETS_DE_DURACION = (0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0)

# La etiqueta route es SIEMPRE la plantilla de la ruta (/productos/{sku}), nunca la ruta real.
PETICIONES = Counter(
    "http_server_requests_total",
    "Peticiones HTTP atendidas.",
    ["method", "route", "status"],
)

DURACION = Histogram(
    "http_server_request_duration_seconds",
    "Duración de las peticiones HTTP en segundos.",
    ["method", "route"],
    buckets=BUCKETS_DE_DURACION,
)

EN_CURSO = Gauge(
    "http_server_requests_in_flight",
    "Peticiones HTTP que se están atendiendo en este momento.",
)

AGOTADOS = Gauge(
    "catalog_products_out_of_stock",
    "Productos con stock cero, por categoría.",
    ["category"],
)

# Una serie por cada falla de caos del servicio: 1 encendida, 0 apagada.
CAOS_ACTIVO = Gauge(
    "chaos_active",
    "Fallas de caos del servicio: 1 si está encendida, 0 si no.",
    ["type"],
)

BUSQUEDAS_SIN_RESULTADOS = Counter(
    "catalog_searches_without_results_total",
    "Búsquedas que no encontraron ningún producto.",
)
