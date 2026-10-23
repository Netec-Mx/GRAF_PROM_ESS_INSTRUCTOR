# Las versiones llegan desde infra/.env por los build args de infra/compose.yaml.
ARG PYTHON_VERSION=3.14.8
ARG UV_VERSION=0.13.0

FROM ghcr.io/astral-sh/uv:${UV_VERSION} AS uv

# Etapa 1: instala las dependencias y el paquete en un entorno virtual.
FROM python:${PYTHON_VERSION}-slim AS constructor
COPY --from=uv /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --locked --no-dev --no-install-project
COPY README.md ./
COPY src ./src
RUN uv sync --locked --no-dev --no-editable

# Etapa 2: imagen final, sin uv ni herramientas de construcción.
FROM python:${PYTHON_VERSION}-slim
RUN useradd --system --uid 10001 --no-create-home --shell /usr/sbin/nologin conciliacion
WORKDIR /app
COPY --from=constructor /app/.venv /app/.venv
ENV PATH="/app/.venv/bin:${PATH}" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1
USER 10001
# El planificador toca un archivo de latido en cada ciclo. Este chequeo usa el mismo Python de
# la imagen para ver que el latido tenga menos de dos intervalos.
HEALTHCHECK --interval=10s --timeout=5s --retries=6 --start-period=20s \
    CMD ["python", "-m", "conciliacion.latido"]
# Por defecto corre el planificador. Una sola corrida: python -m conciliacion.
CMD ["python", "-m", "conciliacion.planificador"]
