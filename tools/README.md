# Herramientas de autor

Sirven para regenerar las imágenes de las guías. El alumno no las necesita.

Requisitos. Node 22 o superior y el stack arriba con `bin/up.sh`.

## Capturas

```bash
tools/capturas/capturar.sh 2
```

Recorre la práctica 2 completa en el stack real y escribe `images/2/1.png`, `2.png` y las demás. La primera vez instala Playwright con la versión de `package-lock.json` y descarga su navegador.

- Cada práctica tiene su archivo de pasos en `tools/capturas/pasos/N.mjs`. Cada paso indica URL o comando, espera, acción, recorte y número de imagen.
- Las capturas de terminal salen de correr el comando de verdad. Un paso de terminal declara con qué código debe salir el comando y qué texto debe traer su salida, así que la corrida también sirve como prueba de que la guía sigue funcionando.
- Ventana de 1440 por 900, Grafana en tema claro y rango de tiempo de los últimos 30 minutos.
- Las esperas son siempre por condición, nunca por tiempo fijo.
- La corrida deja el stack como lo deja un alumno que terminó la práctica. La de la práctica 2 empieza por devolver `infra/prometheus/prometheus.yml` a su versión de git y por borrar el dashboard Tianguis · Primer vistazo y los datasources creados a mano. La de la práctica 3 empieza por dejar `Capitulo3/consultas.md` igual a git y termina igual. La de la práctica 4 borra antes el dashboard Tianguis · RED y `Capitulo4/mi-dashboard.json`.
- La corrida de la práctica 3 hace la ráfaga de cardinalidad. Como la ráfaga elige skus nuevos en cada corrida, se puede repetir sin esperar a que Prometheus suelte las series anteriores.
- Si un paso falla, queda una foto del navegador en `tools/capturas/fallo.png`.
- `HASTA=N tools/capturas/capturar.sh 4` corta la corrida después del paso N y deja una foto en `tools/capturas/hasta.png`. Sirve para escribir un archivo de pasos de a poco.
- `DESDE=N tools/capturas/capturar.sh 5` empieza en el paso N y conserva las imágenes que ya existen. Sirve para retomar una corrida larga después de corregir un paso, siempre que el stack siga como lo dejó el paso anterior. Un dashboard sin guardar no sobrevive, así que no se puede retomar a mitad de su construcción.
- La corrida de la práctica 5 empieza con `Capitulo5/restaurar.sh`, borra en Grafana la regla PagosLentos, el punto de contacto, la política, la plantilla, la carpeta Tianguis y el dashboard, vacía Mailpit y recrea gpe-webhook para que sus logs empiecen vacíos. Las alertas suenan con sus tiempos reales y la corrida espera a ConciliacionSinExito, así que tarda más de media hora. Termina con el código de catalogo, las reglas y Alertmanager como los deja el alumno. Para devolverlos a git, `Capitulo5/restaurar.sh`.
- La corrida de la práctica 6 borra antes el dashboard Tianguis · Multiambiente y `Capitulo6/mi-dashboard.json`, y devuelve `Capitulo6/hallazgo.md` a git. Termina con el trace_id de la corrida anotado en `hallazgo.md`. Antes de commitear, `git checkout -- Capitulo6/hallazgo.md`.

