# Grafana y Prometheus Essentials

**Plataforma de Laboratorios**

Bienvenido a la **Plataforma de Laboratorios** del curso **Grafana y Prometheus Essentials**. Aquí vas a operar una plataforma completa de observabilidad sobre una tienda en línea ficticia, Tianguis Digital, a través de prácticas guiadas.

---

## 🌟 **Lista de Laboratorios**

Cada práctica corresponde a un capítulo del curso y corre sobre el mismo stack de Docker Compose. Haz clic en los enlaces para comenzar.

---

## Índice
 - [Práctica 1. Mapa de señales y comparación de herramientas para un caso real.](./Capitulo1/README.md)
   - **Descripción.** Decidir qué señales necesita cada componente de Tianguis Digital y cómo llega cada una a la plataforma, y contrastarlo con Prometheus y el Pushgateway.
   - ⏱️ **Duración estimada.** 40 minutos.

 - [Práctica 2. Stack de Prometheus y Grafana con Docker Compose.](./Capitulo2/README.md)
   - **Descripción.** Levantar el stack, leer la configuración de Prometheus, cambiarla de forma segura con promtool y una recarga, y armar el primer dashboard en Grafana.
   - ⏱️ **Duración estimada.** 90 minutos.

 - [Práctica 3. Consultas PromQL sobre las métricas de un microservicio.](./Capitulo3/README.md)
   - **Descripción.** Leer el modelo de datos de Prometheus, consultar con PromQL, armar las consultas RED y USE, comparar los tres tipos de distribución y encontrar una bomba de cardinalidad.
   - ⏱️ **Duración estimada.** 120 minutos.

 - [Práctica 4. Dashboard de aplicación web basado en el método RED.](./Capitulo4/README.md)
   - **Descripción.** Armar en Grafana el dashboard RED de Tianguis con sus visualizaciones, transformaciones, opciones de tiempo por panel y logs de Loki, y exportarlo en JSON.
   - ⏱️ **Duración estimada.** 120 minutos.

 - [Práctica 5. Alertas de un microservicio con Alertmanager y Grafana Alerting.](./Capitulo5/README.md)
   - **Descripción.** Agregar una métrica propia a catalogo, crear reglas de registro y de alerta con sus pruebas, rutear en Alertmanager con inhibición y silencios, y armar una alerta gestionada por Grafana.
   - ⏱️ **Duración estimada.** 180 minutos.

 - [Práctica 6. Dashboard dinámico para múltiples ambientes.](./Capitulo6/README.md)
   - **Descripción.** Armar un dashboard con variables, paneles repetidos y una sección condicional para prod y dev, y seguir un pago lento desde un exemplar hasta su traza y sus logs.
   - ⏱️ **Duración estimada.** 120 minutos.

 - [Práctica 7. Red segura y certificados TLS para Prometheus y Grafana.](./Capitulo7/README.md)
   - **Descripción.** Medir la superficie expuesta, crear una CA propia, poner TLS y autenticación en node_exporter, Prometheus y Alertmanager, servir Grafana por HTTPS con login OAuth, roles y una cuenta de servicio, y pasar las claves a archivos.
   - ⏱️ **Duración estimada.** 150 minutos.

 - [Práctica 8. Implementación de Loki y Alloy con microservicios.](./Capitulo8/README.md)
   - **Descripción.** Recorrer la arquitectura de Loki y la interfaz de Alloy, escribir un pipeline que descarta, parsea, pone etiquetas y guarda metadatos, convertir una configuración de Promtail, enviar logs por OTLP, consultar con LogQL y Logs Drilldown y alertar sobre logs con el ruler de Loki.
   - ⏱️ **Duración estimada.** 150 minutos.

 - [Práctica 9. Proxy inverso y escritura remota hacia almacenamiento de largo plazo.](./Capitulo9/README.md)
   - **Descripción.** Separar organizaciones y equipos, pasar Grafana a PostgreSQL con dos réplicas detrás de nginx, aprovisionar dashboards como código, descubrir destinos con archivos y por HTTP, federar, enviar todo a Mimir, poner límites a lo que se guarda y revisar la instancia con Advisor. Al final, el caso de El Buen Fin con tres problemas a la vez.
   - ⏱️ **Duración estimada.** 180 minutos.

---

## 🧰 **Antes de empezar**

Hace falta Docker Desktop con Docker Compose v2 y unos 3 GB de memoria libres para Docker. En Windows los comandos se ejecutan en Git Bash. El detalle del stack, sus puertos y sus scripts está en [docs/stack.md](./docs/stack.md).

---
## 📬 **Contacto y Más Información**

Si tienes alguna pregunta o necesitas más detalles, no dudes en [contactarnos](mailto:soporte@netec.com). También puedes encontrar más recursos en nuestra [página de recursos](https://netec.com).

---

¡Gracias por visitar nuestra plataforma! No olvides revisar todos los laboratorios y comenzar tu viaje de aprendizaje hoy mismo.
