# La versión de Python llega desde infra/.env por los build args de infra/compose.yaml.
# El servicio es un solo archivo y no tiene dependencias fuera de la biblioteca estándar.
ARG PYTHON_VERSION=3.14.8

FROM python:${PYTHON_VERSION}-slim
RUN useradd --system --uid 10001 --no-create-home --shell /usr/sbin/nologin webhook
WORKDIR /app
COPY webhook.py ./
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1
USER 10001
EXPOSE 8080
CMD ["python", "/app/webhook.py"]
