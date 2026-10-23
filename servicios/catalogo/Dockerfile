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
RUN useradd --system --uid 10001 --no-create-home --shell /usr/sbin/nologin catalogo
WORKDIR /app
COPY --from=constructor /app/.venv /app/.venv
COPY datos ./datos
ENV PATH="/app/.venv/bin:${PATH}" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    CATALOGO_DATOS=/app/datos/productos.json
USER 10001
EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=5s --retries=6 --start-period=20s \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/salud', timeout=3)"]
CMD ["python", "-m", "catalogo"]
