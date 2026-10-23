# Guía del relator. Práctica 4. Dashboard de aplicación web basado en el método RED

Capítulo 4 del temario. Duración provisoria de 120 minutos.

La práctica tiene tres ideas. Cada visualización responde un tipo de pregunta y elegir mal la vuelve ilegible. Un panel puede mirar otro momento que el resto del dashboard, y eso sirve para comparar. Y un dashboard junta fuentes distintas, métricas y logs, para que el que lo mira no tenga que saltar de herramienta.

## Diagrama

![diagrama](../images/4/diagrama.png)

La fuente editable está en `images/4/diagrama.mmd` y se vuelve a dibujar con `tools/diagramas/render.sh 4`.

## Familia de analogías

Toda la práctica usa el tablero del mercado. No mezclar con otras analogías.

| Concepto | En el tablero del mercado |
|---|---|
| Dashboard | El pizarrón de la administración del mercado |
| Panel | Cada letrero del pizarrón |
| Stat | El número grande de clientes de hoy |
| Gauge | La aguja de la balanza |
| Bar gauge | Las barras de llenado de cada bodega |
| Heatmap | El mapa de calor de los pasillos más concurridos |
| Transformación | Ordenar las boletas antes de pegarlas en el pizarrón |
| Desplazamiento de tiempo | Pegar al lado la foto del pizarrón de ayer a la misma hora |

## Reparto del tiempo

| Bloque | Minutos |
|---|---|
| Preparar y dashboards sugeridos | 15 |
| Fila Ahora, Stat, Bar gauge y Gauge | 25 |
| Logs de Loki | 10 |
| Fila Tendencia, desplazamiento y tiempo relativo | 20 |
| Heatmap | 10 |
| Fila Referencia, Table, Text y Dashboard list | 25 |
| Guardar, exportar y verificar | 15 |

## Antes de la clase

- Correr `bin/up.sh` una vez en la máquina del alumno para que las imágenes ya estén descargadas.
- Confirmar que Grafana tiene salida a internet. La lista de dashboards sugeridos viene de grafana.com. Si no hay internet en la sala, el plan B es el dashboard propio Host · USE, en `Capitulo4/sin-internet/host-use.json`, que se importa desde archivo como dice la nota del paso 5 de la guía.
- Confirmar que en Grafana no existe un dashboard llamado Tianguis · RED de una clase anterior.
- Si es posible, levantar el stack más de una hora antes. Así el panel desplazado del paso 3 muestra datos y la pregunta del paso se responde mirando.
- Tener a mano `Capitulo4/solucion/tianguis-red.json`. Se carga desde **Dashboards**, **New**, **Import dashboard**.
- La opción **From suggestions** existe en Grafana 13.2 detrás del feature toggle `suggestedDashboards`, que viene apagado. El stack lo enciende en `infra/compose.yaml`. Si un alumno trae un Grafana propio, no la va a ver.

---

## Paso 1. Dashboards sugeridos

**🎯 Problema.** Armar un dashboard desde cero cuesta. Antes de hacerlo conviene saber qué ofrece la comunidad para la fuente que se tiene. Pero un dashboard ajeno responde las preguntas de otro, no las propias.

**👵 Analogía.** Antes de pintar el pizarrón propio, la administración mira el pizarrón que vende hecho una imprenta. Trae letreros bonitos para el agua y la luz del edificio, pero ninguno dice cuántos clientes atendió cada puesto.

**🔮 Predicción.** Antes de abrir Node Exporter Full, preguntar qué va a mostrar sobre Tianguis. La respuesta es nada de la aplicación. Muestra CPU, memoria, disco y red de la máquina.

**💻 Comando.** **Connections**, **Data sources**, **Prometheus**, **Build a dashboard**, **From suggestions**. En **Node Exporter Full**, **View dashboard**. Después **Dashboards** y **Discard**.

| Parte | Qué es |
|---|---|
| **Build a dashboard** | Botón de la página del datasource. Ofrece **From suggestions** y **Blank** |
| **From suggestions** | Ventana con dashboards de grafana.com que usan esa fuente. Son 974 páginas |
| **View dashboard** | Abre el sugerido sin guardarlo, con el datasource ya elegido |
| **Discard** | Descarta el dashboard sin guardar |

**⚙️ Técnico.** La función se llama Suggested dashboards y en Grafana 13.2 está detrás del feature toggle `suggestedDashboards`. El compose del curso lo enciende con `GF_FEATURE_TOGGLES_ENABLE`. Sin el toggle, **Build a dashboard** abre un dashboard en blanco y no hay sugerencias. El camino clásico sigue disponible en **Dashboards**, **New**, **Import dashboard**, con el número de un dashboard de grafana.com. El de Prometheus ya no trae dashboards incluidos en su pestaña de datasource. Node Exporter Full es el 1860.

**📺 Salida.** La ventana Suggested dashboards for your prometheus datasource con tarjetas de Node Exporter Full, ArgoCD, NGINX Ingress e Istio. Node Exporter Full abre con el aviso You are viewing Node Exporter Full y valores reales de la máquina, como CPU Busy y RAM Used.

**⚠️ Fallas.**

| Qué se ve | Causa | Arreglo |
|---|---|---|
| **Build a dashboard** abre un dashboard vacío sin opciones | El toggle no está encendido | Revisar `GF_FEATURE_TOGGLES_ENABLE` en `infra/compose.yaml` y correr `bin/up.sh` |
| La ventana de sugeridos queda vacía | Grafana no tiene salida a internet | Importar `Capitulo4/sin-internet/host-use.json` con **Import dashboard** y recorrerlo en su lugar |
| Algunos paneles de Node Exporter Full dicen N/A | Ese dato no existe dentro de la máquina de Docker, como el disco raíz | Es esperado |

---

## Paso 2. El dashboard RED, filas Ahora y Referencia

**🎯 Problema.** RED son tres números por servicio, pero cada uno se entiende mejor con una forma distinta. Un número suelto, una aguja con zonas de color, barras comparables o una tabla ordenada. Elegir la visualización equivocada esconde el problema.

**👵 Analogía.** El pizarrón de la administración no es una sola hoja. Tiene el número grande de clientes de hoy, la aguja de la balanza que marca si algo pesa demasiado, las barras de llenado de cada bodega y una lista de boletas ordenada antes de pegarla. Cada letrero tiene su forma porque responde una pregunta distinta.

**🔮 Predicción.** Antes de poner los umbrales del Gauge, preguntar de qué color va a quedar con la falla de catalogo encendida. Queda rojo. El 20 % de las respuestas de catalogo falla y eso lleva el total de prod a cerca de 20 %.

**💻 Comando.**

```promql
sum(rate(http_server_requests_total{ambiente="prod"}[5m]))
histogram_quantile(0.95, sum by (job, le) (rate(http_server_request_duration_seconds_bucket{ambiente!="dev", http_route!="/salud"}[5m])))
sum(rate(http_server_requests_total{ambiente="prod", status=~"5.."}[5m])) / sum(rate(http_server_requests_total{ambiente="prod"}[5m]))
topk(10, sum by (job, route) (rate(http_server_requests_total{ambiente="prod"}[5m])))
```

| Parte | Qué es |
|---|---|
| **Stat** | Un valor grande con un gráfico de fondo |
| **Bar gauge** | Una barra por serie, para comparar servicios |
| **Gauge** | Una aguja con zonas de color según umbrales |
| **Unit** | Cómo se muestra el número. `Percent (0.0-1.0)` multiplica por 100 |
| **Thresholds** | Límites donde cambia el color. **Add threshold** agrega uno amarillo en 90 |
| **Table** con **Format** Table y **Type** Instant | Un valor por serie en filas, sin eje de tiempo |
| **Sort by** | Transformación que ordena las filas por un campo |
| **Organize fields by name** | Transformación que oculta, renombra y ordena columnas |
| **Text** | Markdown fijo, para explicar el dashboard |
| **Dashboard list** | Enlaces a otros dashboards, por búsqueda, estrella o recientes |

**⚙️ Técnico.** `ambiente!="dev"` también es verdadero para las series que no tienen esa etiqueta, así entra pagos, que manda sus métricas por OpenTelemetry y no lleva `ambiente`. El chequeo de salud de pagos sí queda registrado en su histograma, por eso se quita con `http_route!="/salud"`. pagos tiene un p95 de cientos de milisegundos porque simula la pasarela. `topk` no garantiza el orden de las filas, por eso hace falta **Sort by**. Las transformaciones corren en el navegador después de la consulta, no en Prometheus. **Dashboard list** busca entre los dashboards guardados, así que hasta guardar no se lista a sí mismo.

**📺 Salida.** Stat cerca de 4 req/s. Bar gauge con catalogo cerca de 5 ms, pedidos cerca de 8 ms y pagos cerca de 400 ms. Gauge en rojo cerca de 20 %. Tabla con cinco rutas ordenadas de mayor a menor, sin columna Time y con la columna Por segundo. Texto con el método RED. Lista con Tianguis · RED después de guardar.

**⚠️ Fallas.**

| Qué se ve | Causa | Arreglo |
|---|---|---|
| El Gauge queda verde | La falla de catalogo venció, dura 60 minutos | Volver a correr `Capitulo4/preparar.sh` |
| Al escribir la unidad aparece Custom unit | Se pulsó la segunda opción | Elegir la primera, la que dice la categoría, como Throughput |
| La tabla muestra una fila por instante | Quedó **Type** en Range | Elegir Instant y **Run queries** |
| La tabla no muestra la columna renombrada | Se escribió el nombre en otra fila de Organize | El nombre nuevo va en **Rename Value** |
| El Text sigue diciendo Title | No se hizo clic fuera del editor | El contenido se aplica al salir del editor |

---

## Paso 3. Desplazamiento de tiempo y tiempo relativo

**🎯 Problema.** Un gráfico solo de ahora no dice si ahora es raro. Hace falta compararlo con otro momento, y a veces un panel necesita mirar una ventana distinta del resto, por ejemplo solo los últimos minutos.

**👵 Analogía.** Para saber si hoy hay más clientes que de costumbre, la administración pega al lado la foto del pizarrón de ayer a la misma hora. Y en una esquina deja un letrero que solo cuenta lo de los últimos cinco minutos, aunque el resto del pizarrón muestre la mañana entera.

**🔮 Predicción.** Antes de guardar, preguntar qué va a mostrar el panel desplazado si el stack lleva menos de una hora arriba. Muestra No data o solo la parte de la hora anterior en que el stack ya estaba arriba. Si el volumen de Prometheus trae datos de días anteriores, puede mostrar un hueco en el medio.

**💻 Comando.** **Query options**, al lado de **Data source**. **Time shift** `1h` en un panel y **Relative time** `5m` en otro.

```promql
sum by (job, ambiente) (rate(http_server_requests_total[5m]))
sum by (job) (rate(http_server_requests_total{status=~"5.."}[1m]))
```

| Parte | Qué es |
|---|---|
| **Time shift** `1h` | El panel consulta el mismo rango del dashboard, una hora antes |
| **Relative time** `5m` | El panel usa siempre los últimos 5 minutos, sin importar el rango del dashboard |
| Timeshift -1h y Last 5 minutes | Avisos azules que Grafana pone junto al título |

**⚙️ Técnico.** Grafana resuelve las dos opciones antes de mandar la consulta, así que Prometheus recibe otro rango de tiempo y no se entera de nada. El desplazamiento se aplica al panel entero. Para tener la hora actual y la anterior en el mismo gráfico hay que agregar una segunda consulta con `offset 1h` en PromQL. En el JSON quedan como `timeShift` y `timeFrom` del panel. En la vista con pantalla angosta el botón **Query options** se acorta a Q y tres puntos.

**📺 Salida.** Dos paneles lado a lado con la misma forma de curvas y horas de eje distintas. El de tiempo relativo muestra el eje de los últimos 5 minutos con puntos cada 15 segundos.

**⚠️ Fallas.**

| Qué se ve | Causa | Arreglo |
|---|---|---|
| El panel desplazado dice No data | El stack lleva menos de una hora arriba | Es la respuesta de la predicción |
| El cambio no se aplica | No se salió del campo | Hacer clic fuera del campo |
| Se desplazó todo el dashboard | Se cambió el selector de tiempo de arriba | Volver a Last 30 minutes y usar **Query options** |

---

## Paso 4. Una segunda fuente de datos, los logs

**🎯 Problema.** El Gauge dice cuánto falla, pero no qué falla. Para eso hacen falta los logs, y si están en otra herramienta, el que mira el dashboard pierde tiempo saltando de una a otra.

**👵 Analogía.** Al lado de la aguja de la balanza que marca demasiado, la administración pega las boletas de reclamo del puesto que falla. Se ve la cantidad y el detalle en el mismo pizarrón.

**🔮 Predicción.** Antes de ejecutar la consulta de Loki, preguntar si van a aparecer errores de catalogo-dev. No aparecen. `compose_service="catalogo"` es exactamente prod, y la falla está solo en prod.

**💻 Comando.**

```logql
{compose_service="catalogo"} | json | level="error"
```

| Parte | Qué es |
|---|---|
| `{compose_service="catalogo"}` | Selector de flujo. Etiqueta que Alloy pone al leer el contenedor |
| `| json` | Convierte los campos de la línea JSON en etiquetas |
| `level="error"` | Filtro sobre la etiqueta extraída |
| **Logs** | Visualización que muestra líneas con su nivel en color |

**⚙️ Técnico.** Alloy lee los logs de los contenedores del proyecto por el socket de Docker y los manda a Loki con las etiquetas `container`, `compose_service` y, para catalogo y pedidos, `ambiente`. catalogo escribe una línea JSON por petición con `level` igual a `error` para las respuestas 5xx. Un mismo dashboard puede tener paneles de fuentes distintas. La fuente se elige por panel, en **Data source**.

**📺 Salida.** Líneas con el nivel ERROR en rojo y el JSON de cada petición fallida de catalogo, una cada pocos segundos.

**⚠️ Fallas.**

| Qué se ve | Causa | Arreglo |
|---|---|---|
| No data | La consulta se escribió con la fuente Prometheus | Cambiar **Data source** a Loki |
| parse error | Se escribió en modo Builder | Cambiar a **Code** |
| Aparecen líneas de nivel warning | Falta el filtro `level="error"` | Agregarlo después de `| json` |

---

## Paso 5. Heatmap y orden en filas

**🎯 Problema.** El p95 resume la distribución en un número y pierde su forma. Un heatmap muestra la distribución completa a lo largo del tiempo. Y con once paneles, un dashboard sin orden se vuelve una pared de gráficos.

**👵 Analogía.** El mapa de calor de los pasillos pinta más fuerte donde más gente pasa, hora por hora. Y el pizarrón se divide en secciones, lo de ahora arriba, la tendencia al medio y la referencia abajo, para que cada uno vaya directo a lo suyo.

**🔮 Predicción.** Antes de elegir Heatmap, preguntar en qué franja va a estar la mancha más oscura. Entre 0 y 5 ms, donde cae casi todo pedidos. Si se corrió el caos de latencia de la Práctica 3 en la última media hora, se ve una franja más clara cerca de 0.25 a 0.5.

**💻 Comando.**

```promql
sum by (le) (rate(http_server_request_duration_seconds_bucket{job="pedidos", ambiente="prod"}[5m]))
```

| Parte | Qué es |
|---|---|
| **Format** Heatmap | Grafana ordena los buckets por `le` y los convierte en celdas |
| **Heatmap** | Visualización con tiempo en el eje horizontal y buckets en el vertical |
| **Add row** | Crea una fila. Los paneles nuevos quedan dentro de la última fila |

**⚙️ Técnico.** Con Format Heatmap, Grafana resta cada bucket del anterior porque los clásicos son acumulativos. Sin ese formato el mapa sale mal. Calculate from data queda en No porque los buckets ya vienen calculados. En Grafana 13.2 los paneles no se pueden pasar de una fila a otra sin arrastrarlos, por eso la guía crea cada fila antes de sus paneles. **Group panels** existe, pero mete todos los paneles en una sola fila o pestaña.

**📺 Salida.** Un mapa con una franja naranja intensa en 0.005 y celdas claras hasta 0.025. Tres filas con su título y su flecha para plegarlas.

**⚠️ Fallas.**

| Qué se ve | Causa | Arreglo |
|---|---|---|
| El heatmap muestra una sola franja en +Inf | **Format** quedó en Time series | Elegir Heatmap en **Options** |
| Las filas quedaron vacías y los paneles fuera | Se agregaron los paneles antes de crear la fila | Crear la fila con **Add row** y volver a agregar los paneles |
| No aparece **Add row** debajo de los paneles | El dashboard no está en modo edición | Pulsar **Edit** |

---

## Paso 6. Guardar, exportar y verificar

**🎯 Problema.** Un dashboard que vive solo en la base de datos de Grafana se pierde con el volumen y no se puede revisar ni versionar. Exportarlo en JSON lo vuelve un archivo que se guarda en git.

**👵 Analogía.** Al cerrar, la administración le saca una foto al pizarrón y la guarda en el archivo. Si mañana alguien lo borra, se vuelve a pintar igual a partir de la foto.

**🔮 Predicción.** Antes del Enter de `verificar.sh`, preguntar qué revisión puede fallar. La más común es la del archivo, porque queda en Descargas con otro nombre.

**💻 Comando.**

```bash
mv ~/Downloads/Tianguis*RED*.json Capitulo4/mi-dashboard.json
Capitulo4/verificar.sh
```

| Parte | Qué es |
|---|---|
| **Export**, **Export as code** | Muestra el JSON del dashboard. **Download file** lo descarga |
| `~/Downloads` | Carpeta de descargas. En Git Bash es la misma carpeta de Windows |
| `Tianguis*RED*.json` | Grafana nombra el archivo con el título y un número de tiempo |
| `verificar.sh` | 16 revisiones contra la API de Grafana y el archivo exportado |

**⚙️ Técnico.** Con el layout nuevo de Grafana 13 el JSON exportado es un recurso `dashboard.grafana.app/v2`, con `elements` y `layout`. La API clásica `/api/dashboards/uid` sigue devolviéndolo en el formato antiguo, con las filas como paneles de tipo row, y eso es lo que lee `verificar.sh`. **Share dashboard with another instance** reemplaza las fuentes por variables de entrada, útil para llevarlo a otro Grafana. Aquí no hace falta porque los uid de las fuentes están fijos en el aprovisionamiento. El JSON trae `metadata` propia de esta instalación, la solución la deja solo con el nombre.

**📺 Salida.** El archivo en `Capitulo4/mi-dashboard.json` y dieciséis líneas en verde con PRÁCTICA LOGRADA 16 de 16 verificaciones en verde.

**⚠️ Fallas.**

| Qué se ve | Causa | Arreglo |
|---|---|---|
| mv dice No such file or directory | El navegador descarga en otra carpeta | Buscar el archivo y moverlo a mano |
| mv dice target is not a directory | Hay varios archivos Tianguis en Descargas | Borrar los anteriores y repetir |
| No existe el dashboard Tianguis · RED | Se guardó con otro título | Abrir **Settings** y cambiar el título |
| Falta un panel Gauge | Se eligió otra visualización con nombre parecido | Revisar el nombre en **All visualizations** |

---

## ❓ Preguntas del alumno

Son preguntas de un alumno de nivel intermedio, que maneja la terminal y Docker básico pero no conoce Prometheus ni Grafana.

**¿Qué es un contenedor y dónde corre Grafana?**
Grafana, Prometheus, Loki y los servicios de Tianguis corren cada uno en un contenedor de Docker que levanta el stack. El navegador entra a Grafana por el puerto 3000 de la máquina.

**¿Qué es un panel?**
Es cada recuadro del dashboard, como cada letrero del pizarrón del mercado. Tiene su propia consulta, su fuente de datos y su visualización.

**¿Qué es una etiqueta como `job` o `ambiente`?**
Es un par de nombre y valor que acompaña a cada serie. Sirve para filtrar dentro de las llaves de la consulta y para agrupar con `sum by`.

**¿Por qué un panel recién creado no muestra datos?**
Lo más común es que la consulta no se ejecutó o que quedó elegida otra fuente de datos. Se revisa **Data source** y se pulsa Shift y Enter en el editor **Code**.

**¿Por qué hay que esperar unos minutos para que las curvas se llenen?**
Prometheus toma una muestra cada 15 segundos y `rate` con `[5m]` necesita varias muestras dentro de la ventana. Al principio las curvas salen cortas y se completan con el paso de los minutos.

**¿Por qué `[5m]` y no `$__rate_interval`?**
`$__rate_interval` ajusta la ventana al rango y al intervalo de scrape, y es lo recomendado en Grafana. Aquí se usa `[5m]` para que las consultas sean idénticas a las de la Práctica 3 y se puedan pegar en Prometheus.

**¿Cuál es la diferencia entre Gauge y Bar gauge?**
El Gauge muestra un valor contra un rango, como una aguja. El Bar gauge muestra varias barras para comparar series entre sí. Si hay un solo número, Gauge. Si hay uno por servicio, Bar gauge.

**¿Por qué los umbrales se escriben como 0.01 y no como 1?**
Porque la unidad `Percent (0.0-1.0)` solo cambia cómo se muestra el número. Los umbrales comparan contra el valor real, que es una proporción entre 0 y 1.

**¿Las transformaciones cargan a Prometheus?**
No. Prometheus responde la consulta y Grafana aplica las transformaciones en el navegador. Sirven para dar forma, no para reducir lo que se consulta.

**¿Se puede tener la hora actual y la anterior en el mismo gráfico?**
Sí, con una segunda consulta que use `offset 1h`. Time shift desplaza el panel entero y por eso se usa en un panel aparte.

**¿Dónde queda guardado el dashboard?**
En la base de datos interna de Grafana, en el volumen `gpe_grafana-datos`. El archivo exportado es la copia para git. Cargar dashboards desde archivos al arrancar se ve en el Capítulo 9.

**¿Por qué Grafana muestra la hora local y Prometheus la hora UTC?**
Grafana usa la zona horaria del navegador por defecto. La interfaz de Prometheus muestra UTC salvo que se cambie en su configuración. Los datos son los mismos.
