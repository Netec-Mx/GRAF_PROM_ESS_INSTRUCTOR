# webhook

Receptor de webhooks del laboratorio. Alertmanager y Grafana le mandan sus notificaciones y
el servicio escribe cada una como una línea JSON por stdout. Alloy recoge esa salida, así que
las notificaciones quedan en Loki con `compose_service="webhook"`.

Existe para que la Práctica 5 muestre notificaciones por webhook sin depender de Slack ni de
Teams. No guarda nada ni publica puertos en el host.

## API

| Ruta | Qué hace |
|---|---|
| `POST` cualquier ruta | Escribe la notificación en una línea JSON y responde 200. |
| `GET /salud` | 200 si el servicio está vivo. |

Alertmanager llama a `http://webhook:8080/alertmanager` y Grafana a `http://webhook:8080/grafana`.
La ruta queda en el campo `ruta` de la línea.

## Una línea

```json
{"time":"2026-10-15T03:12:44.120+00:00","level":"info","msg":"notificacion recibida","ruta":"/alertmanager","receiver":"guardia-webhook","status":"firing","alertas":1,"alertnames":"ErroresAltos","notificacion":{"...":"cuerpo completo"}}
```

`receiver`, `status`, `alertas` y `alertnames` salen del cuerpo para poder filtrar en Loki sin
abrir el JSON completo.

```logql
{compose_service="webhook"} | json | status="resolved"
```

## Ver lo recibido

```bash
docker logs gpe-webhook
```

## Calidad

```bash
uvx ruff check .
uvx ruff format --check .
uvx --with mypy mypy webhook.py
```
