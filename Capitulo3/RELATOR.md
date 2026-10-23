# Guía del relator. Práctica 3. Consultas PromQL sobre las métricas de un microservicio

Capítulo 3 del temario. Duración provisoria de 120 minutos.

La práctica tiene tres ideas. Un contador no se lee por su valor sino por cuánto crece, y `rate` sabe cuándo lo cambiaron. Una distribución se puede guardar de tres maneras y solo una se deja sumar sin perder precisión. Y cada combinación distinta de etiquetas es una serie nueva, así que una sola etiqueta mal elegida puede multiplicar la memoria de Prometheus.

## Diagrama

![diagrama](../images/3/diagrama.png)

La fuente editable está en `images/3/diagrama.mmd` y se vuelve a dibujar con `tools/diagramas/render.sh 3`.

## Familia de analogías

Toda la práctica usa el mercado y sus medidores. No mezclar con otras analogías.

| Concepto | En el mercado |
|---|---|
| counter | El medidor del agua del puesto, solo sube |
| `rate` | Cuántos litros por minuto, mirando el medidor dos veces |
| reset | Cambiaron el medidor y volvió a cero, `rate` lo entiende |
| gauge | El nivel del estanque, sube y baja |
| Histograma clásico | Los cajones donde se clasifica la fruta por tamaño |
| Histograma nativo | Cajones que se ajustan solos al tamaño de la fruta que llega |
| summary | El puestero que solo anota su propio percentil, y no se puede sumar con el del puesto de al lado |
| Cardinalidad | Abrir un cuaderno nuevo por cada cliente en vez de uno por producto |

## Reparto del tiempo

| Bloque | Minutos |
|---|---|
| Preparar y leer el formato de exposición | 15 |
| Selectores | 10 |
| rate, irate, increase y el reinicio | 15 |
| Agregaciones | 10 |
| RED de pedidos | 15 |
| Tres tipos de distribución | 15 |
| USE de la máquina | 10 |
| Caos de latencia | 10 |
| Bomba de cardinalidad | 15 |
| Verificar y cerrar | 5 |

## Antes de la clase

- Correr `bin/up.sh` una vez en la máquina del alumno para que las imágenes ya estén descargadas.
- Confirmar que `Capitulo3/consultas.md` esté vacío, igual que en git. Si un alumno repite la práctica, puede borrar sus respuestas a mano.
- Tener a mano `Capitulo3/solucion/consultas.md`.
- `Capitulo3/rafaga-skus.sh` elige sus 180 skus inexistentes a partir de la hora, así que un alumno que repite la práctica vuelve a ver crecer las series.

---

## Paso 1. Leer el formato de exposición

**🎯 Problema.** Antes de consultar hay que saber qué tipo de métrica se tiene delante. Un contador y un gauge se ven iguales en un gráfico de valores crudos, pero se leen con funciones distintas. Confundirlos da números que parecen razonables y no significan nada.

**👵 Analogía.** En el mercado hay dos clases de aparatos. El medidor del agua del puesto solo avanza, nunca retrocede. El nivel del estanque sube cuando llueve y baja cuando se riega. Y en la bodega hay cajones donde se clasifica la fruta por tamaño. Mirar la placa de cada aparato dice cuál es cuál. En Prometheus esa placa es la línea `# TYPE`.

**🔮 Predicción.** Antes del `grep` de la ruta `/productos`, preguntar. ¿Cuántas líneas va a devolver para una sola ruta? La mayoría dice una o dos. Son 16. El histograma se reparte en 11 buckets más `_count`, `_sum` y `_created`, y el contador trae también su `_created`.

**💻 Comando.**

```bash
Capitulo3/preparar.sh
curl -s http://localhost:8001/metrics | grep "^# TYPE"
curl -s http://localhost:8001/metrics | grep 'route="/productos"'
curl -s http://localhost:8002/metrics | grep orders_
```

| Parte | Qué es |
|---|---|
| `Capitulo3/preparar.sh` | Llama a `bin/up.sh`, deja el tráfico normal, corre `bin/caos.sh apagar` y reinicia gpe-catalogo |
| `curl -s` | Pide la página sin mostrar la barra de progreso |
| `/metrics` | Ruta donde cada servicio publica sus métricas en texto |
| `grep "^# TYPE"` | Deja solo las líneas que empiezan con `# TYPE`, una por métrica |
| `grep orders_` | Deja las líneas de las métricas de negocio de pedidos |

**⚙️ Técnico.** catalogo usa `prometheus_client` de Python, que agrega una serie `_created` por cada contador e histograma con el momento en que nació. Por eso aparece declarada como gauge. Los buckets son acumulativos. El de `le="0.01"` incluye todo lo que ya contó el de `le="0.005"`, y el de `le="+Inf"` siempre vale lo mismo que `_count`. pedidos está escrito en Go y su histograma HTTP es nativo y clásico a la vez. La parte nativa solo viaja en protobuf, por eso `curl` muestra solo la clásica.

**📺 Salida.** El primer `curl` lista 19 líneas `# TYPE`. El de la ruta muestra 16 líneas con valores bajos, porque catalogo se acaba de reiniciar. El de pedidos muestra `orders_created_total` con sus cuatro resultados y el summary con los cuantiles 0.5, 0.9 y 0.99, más `_sum` y `_count`.

**⚠️ Fallas.**

| Qué se ve | Causa | Arreglo |
|---|---|---|
| `curl: (7) Failed to connect` | El puerto de catalogo no es 8001 en esa máquina | Usar el puerto que muestra `bin/estado.sh` |
| El `grep` de la ruta no devuelve nada | catalogo acaba de reiniciar y nadie pidió `/productos` todavía | Esperar 10 segundos y repetir |
| En Git Bash las comillas del `grep` fallan | Se copiaron comillas tipográficas | Escribir las comillas simples a mano |

---

## Paso 2. Selectores

**🎯 Problema.** Una métrica tiene decenas de series. Sin filtrar por etiquetas, cualquier consulta mezcla prod con dev, pedidos con catalogo y respuestas buenas con errores.

**👵 Analogía.** El mercado tiene un medidor del agua en cada puesto, de cada pasillo, en dos sedes. Para leer el consumo de un puesto hay que decir de qué sede, qué pasillo y qué puesto. Las etiquetas son esa dirección.

**🔮 Predicción.** Antes de ejecutar el filtro `status=~"5.."`, preguntar qué va a devolver. Muchos esperan alguna serie. Sale vacío, porque pedidos no ha respondido ningún 5xx desde que arrancó. Vacío no es error.

**💻 Comando.**

```promql
http_server_requests_total{job="pedidos", ambiente="prod"}
http_server_requests_total{job="pedidos", ambiente="prod", status=~"5.."}
http_server_requests_total{job="pedidos", ambiente="prod", status=~"4.."}
{"http_server_requests_total", job="catalogo"}
```

| Parte | Qué es |
|---|---|
| `{job="pedidos"}` | Matcher de igualdad. Deja las series cuya etiqueta vale exactamente eso |
| `status=~"5.."` | Matcher de expresión regular. El punto es cualquier carácter, así que pide un 5 seguido de dos cualquiera |
| `!=` y `!~` | Las versiones negadas. No se usan aquí, conviene nombrarlas |
| `{"nombre", ...}` | Sintaxis de Prometheus 3. El nombre de la métrica va entre comillas dentro de las llaves |

**⚙️ Técnico.** La expresión regular siempre está anclada al principio y al final. `status=~"5"` no encuentra `500`. El nombre entre comillas existe porque Prometheus 3 acepta nombres con caracteres UTF-8, como los puntos de OpenTelemetry. Es lo mismo que escribir `{__name__="http_server_requests_total"}`. En este stack los nombres de OpenTelemetry se traducen a guiones bajos al entrar, así que la sintaxis se muestra sobre una métrica que ya existe.

**📺 Salida.** Cuatro series de pedidos prod, con status 200, 201 y 422. El filtro 5xx muestra Empty query result. El filtro 4xx muestra la serie del 422. La forma entre comillas devuelve las series de catalogo de prod y dev.

**⚠️ Fallas.**

| Qué se ve | Causa | Arreglo |
|---|---|---|
| parse error, unexpected character | Se usó `=` en vez de `=~` con una expresión regular, o comillas tipográficas | Revisar el operador y las comillas |
| El filtro 4xx también sale vacío | pedidos se reinició hace poco y aún no rechaza ningún pedido | Esperar un minuto |
| Aparecen series 404 en `/pedidos/{id}` | pedidos se reinició y perdió los pedidos en memoria que k6 sigue pidiendo | Es esperado. También es una respuesta 4xx |

---

## Paso 3. rate, irate, increase y el reinicio

**🎯 Problema.** El valor de un contador es un total acumulado desde que el proceso arrancó. Por sí solo no responde nada útil. Y si el proceso se reinicia, el total vuelve a cero y un cálculo ingenuo daría una caída enorme.

**👵 Analogía.** El medidor del agua del puesto dice 39 mil litros. Eso no dice si hoy se gasta más que ayer. Para saberlo hay que mirarlo dos veces y dividir por el tiempo, litros por minuto. Si cambian el medidor por uno nuevo, que parte en cero, el que lee con cuidado no anota que el puesto devolvió 39 mil litros. Entiende que cambiaron el aparato y sigue sumando desde el nuevo.

**🔮 Predicción.** Antes de `docker restart gpe-pedidos`, preguntar qué va a hacer el gráfico de `rate`. Casi todos esperan una caída o un pico negativo. La línea sigue pareja, porque `rate` detecta que el valor bajó y lo interpreta como un reinicio.

**💻 Comando.**

```promql
orders_created_total{job="pedidos", ambiente="prod", result="confirmed"}
rate(orders_created_total{job="pedidos", ambiente="prod", result="confirmed"}[5m])
irate(orders_created_total{job="pedidos", ambiente="prod", result="confirmed"}[5m])
increase(orders_created_total{job="pedidos", ambiente="prod", result="confirmed"}[1h])
resets(orders_created_total{job="pedidos", ambiente="prod", result="confirmed"}[30m])
```

```bash
docker restart gpe-pedidos
```

| Parte | Qué es |
|---|---|
| `[5m]` | Vector de rango. Todas las muestras de los últimos 5 minutos de cada serie |
| `rate` | Aumento por segundo promediado sobre toda la ventana |
| `irate` | Aumento por segundo entre las dos últimas muestras de la ventana |
| `increase` | Aumento total en la ventana. Es `rate` multiplicado por los segundos de la ventana |
| `resets` | Cuántas veces el valor bajó dentro de la ventana |

**⚙️ Técnico.** `rate` necesita al menos dos muestras en la ventana. Con un scrape cada 15 segundos, la ventana mínima razonable es de un minuto y lo habitual son 4 veces el intervalo o más. `increase` extrapola hasta los bordes de la ventana, por eso casi nunca da un entero aunque el contador cuente pedidos. `irate` sirve para gráficos de alta resolución y no para alertas, porque depende de dos muestras.

**📺 Salida.** El contador crudo sube en escalera. `rate` es una línea suave alrededor de 0.2 pedidos por segundo. `irate` salta entre 0 y 0.5. Después del reinicio el contador cae a 0 en un instante y `rate` sigue sin escalón. `resets` devuelve 1.

**⚠️ Fallas.**

| Qué se ve | Causa | Arreglo |
|---|---|---|
| `rate` muestra un hueco justo en el reinicio | Se miró antes de que hubiera dos muestras nuevas | Esperar los 2 minutos de la guía |
| `resets` devuelve 0 | Pasaron más de 30 minutos desde el reinicio | Es correcto. Ampliar la ventana a `[1h]` para verlo |
| `increase` da un número con decimales | Extrapolación a los bordes de la ventana | Es esperado, no es un error |

---

## Paso 4. Agregaciones

**🎯 Problema.** `rate` sobre una métrica devuelve una serie por cada combinación de etiquetas. Con tráfico real son decenas y nadie lee un gráfico de cuarenta líneas. Además, las series individuales cambian cuando aparece una ruta o un código nuevo.

**👵 Analogía.** La administración no quiere el consumo de cada llave de cada puesto. Quiere el total por pasillo y por sede, y saber cuáles son los tres puestos que más gastan.

**🔮 Predicción.** Antes de ejecutar `rate` sin agregar, preguntar cuántas series va a devolver. Suelen decir 4 u 8. Son unas 18, entre prod y dev, rutas y códigos.

**💻 Comando.**

```promql
rate(http_server_requests_total[5m])
sum by (job, ambiente) (rate(http_server_requests_total[5m]))
topk(3, sum by (job, route) (rate(http_server_requests_total[5m])))
```

| Parte | Qué es |
|---|---|
| `sum by (job, ambiente)` | Suma todas las series y conserva solo esas dos etiquetas |
| `without (...)` | La forma inversa. Quita las etiquetas nombradas y conserva el resto |
| `topk(3, ...)` | Deja las tres series de mayor valor en cada instante |

**⚙️ Técnico.** El orden importa. Primero `rate` y después `sum`. Sumar contadores crudos y aplicar `rate` al resultado rompe la detección de reinicios, porque un reinicio de una sola serie no hace bajar la suma. `topk` se evalúa en cada instante, así que en un gráfico las tres series pueden cambiar a lo largo del tiempo.

**📺 Salida.** 18 series sin agregar. 4 con `sum by (job, ambiente)`, catalogo prod con unas 3 peticiones por segundo y las otras bajo 1. `topk` deja `/productos/{sku}`, `/productos` y una tercera ruta.

**⚠️ Fallas.**

| Qué se ve | Causa | Arreglo |
|---|---|---|
| `sum by` devuelve una sola serie | Se escribió `sum(...)` sin `by` | Agregar `by (job, ambiente)` |
| `topk` devuelve más de 3 en el gráfico | En cada instante son 3, pero cambian en el tiempo | Mirarlo en **Table** |
| expected type range vector | Se pasó un contador sin `[5m]` a `rate` | Agregar la ventana |

---

## Paso 5. RED de pedidos

**🎯 Problema.** Para saber si un servicio está sano desde el punto de vista del cliente alcanza con tres números. Cuánto atiende, cuánto falla y cuánto tarda. Pero la consulta de errores tiene una trampa. Cuando no hay ningún error, devuelve vacío en vez de cero.

**👵 Analogía.** Del puesto se miran tres medidores. Cuántos clientes por minuto, cuántos se van sin comprar y cuánto esperan en la fila. Si nadie se fue sin comprar, el cuaderno de reclamos está en blanco. En blanco no es lo mismo que cero, y un tablero que dice sin datos asusta más que uno que dice cero.

**🔮 Predicción.** Antes de ejecutar la división de errores sin `or vector(0)`, preguntar qué va a mostrar. Esperan 0. Sale vacía.

**💻 Comando.**

```promql
sum(rate(http_server_requests_total{job="pedidos", ambiente="prod"}[5m]))
(sum(rate(http_server_requests_total{job="pedidos", ambiente="prod", status=~"5.."}[5m])) or vector(0))
  /
sum(rate(http_server_requests_total{job="pedidos", ambiente="prod"}[5m]))
histogram_quantile(0.95, sum(rate(http_server_request_duration_seconds{job="pedidos", ambiente="prod"}[5m])))
```

| Parte | Qué es |
|---|---|
| Rate | Peticiones por segundo |
| Errors | Peticiones con 5xx divididas por todas |
| Duration | Percentil 95 de la duración |
| `or vector(0)` | Si el lado izquierdo no tiene series, usa un vector con valor 0 y sin etiquetas |
| `histogram_quantile(0.95, ...)` | Estima el percentil 95 a partir de un histograma |

**⚙️ Técnico.** `or` funciona aquí porque `sum` sin `by` deja una serie sin etiquetas, igual que `vector(0)`. Con `sum by (job)` haría falta otro patrón. Los 422 de pedidos son rechazos de negocio, sin stock o sku inexistente. RED los deja fuera porque el servicio respondió bien. El histograma nativo se consulta con el nombre de la métrica, sin `_bucket` y sin `by (le)`, porque cada muestra ya trae todos sus buckets adentro.

**📺 Salida.** La tasa ronda 0.5 peticiones por segundo. La división sin respaldo muestra Empty query result. Con `or vector(0)` da 0. El p95 nativo ronda 0.006 a 0.008 segundos.

**⚠️ Fallas.**

| Qué se ve | Causa | Arreglo |
|---|---|---|
| La proporción da 0 aunque hay caos de errores | El caos está en catalogo y la consulta mira pedidos | Es correcto. Cambiar el job para verlo |
| `histogram_quantile` devuelve NaN | No hubo peticiones en la ventana | Revisar que haya tráfico con `bin/trafico.sh estado` |
| El p95 nativo sale vacío | Se escribió `_bucket` o `by (le)` en la consulta nativa | Usar el nombre sin sufijo |

---

## Paso 6. Tres tipos de distribución

**🎯 Problema.** Un promedio esconde a los clientes que esperan mucho. Para ver la cola hace falta una distribución, y hay tres maneras de guardarla. Cada una tiene un costo distinto y una precisión distinta, y solo algunas se pueden sumar entre instancias.

**👵 Analogía.** En la bodega la fruta se clasifica en cajones por tamaño. Los cajones fijos, uno para menos de 5 cm, otro hasta 10, otro hasta 25, son el histograma clásico. Si casi toda la fruta mide 3 cm, todo cae en el primer cajón y no se sabe si mide 1 o 4. Los cajones que se ajustan solos al tamaño de la fruta que llega son el histograma nativo. Y está el puestero que solo anota su propio percentil en un papel. Su número no se puede sumar con el del puesto de al lado.

**🔮 Predicción.** Antes de comparar nativo contra clásico, preguntar cuál va a dar un p95 más alto. El clásico suele dar más, porque interpola de forma lineal dentro de un bucket ancho. Al final del paso, preguntar cuál de los tres es más confiable. La respuesta esperada es el nativo. Tiene buckets angostos, se puede agregar entre instancias y no depende de que alguien haya elegido bien los límites.

**💻 Comando.**

```promql
histogram_quantile(0.95, sum by (le) (rate(http_server_request_duration_seconds_bucket{job="catalogo", ambiente="prod"}[5m])))
http_server_request_duration_seconds{job="pedidos", ambiente="prod", method="POST"}
histogram_quantile(0.95, sum(rate(http_server_request_duration_seconds{job="pedidos", ambiente="prod"}[5m])))
histogram_quantile(0.95, sum by (le) (rate(http_server_request_duration_seconds_bucket{job="pedidos", ambiente="prod"}[5m])))
orders_lines_per_order{quantile="0.9"}
```

| Parte | Qué es |
|---|---|
| `_bucket` y `by (le)` | Forma clásica. Se suman los buckets conservando el límite superior |
| Sin sufijo | Forma nativa. La muestra trae todos sus buckets |
| `{quantile="0.9"}` | Summary. El percentil ya viene calculado por el servicio |

**⚙️ Técnico.** Los buckets clásicos de los dos servicios son 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5 y 5 segundos. El nativo de pedidos usa un factor de 1.1, cada bucket a lo más un 10 % más ancho que el anterior, con hasta 160 buckets. El summary calcula sus cuantiles en una ventana deslizante de 10 minutos dentro del proceso. Por eso se pierde con cada reinicio y no se puede agregar. `avg(orders_lines_per_order{quantile="0.9"})` da un número, pero no es el percentil 90 de nada.

**📺 Salida.** El p95 de catalogo queda en torno a 0.0048, pegado al techo de 0.005 del primer bucket. La tabla del histograma nativo muestra un gráfico de barras con buckets finos entre 1 y 10 ms, con su Count y su Sum. El p95 nativo de pedidos queda cerca de 0.006 y el clásico cerca de 0.008. El summary devuelve dos series, prod y dev.

**⚠️ Fallas.**

| Qué se ve | Causa | Arreglo |
|---|---|---|
| El histograma nativo se ve con pocas barras | pedidos se reinició en el paso 3 y el histograma acumula desde entonces | Es esperado. Se llena con los minutos |
| Nativo y clásico dan igual | Poco tráfico en la ventana | Ampliar a `[10m]` |
| La tabla del nativo no muestra gráfico | Se consultó con `_bucket` | Usar el nombre sin sufijo |

---

## Paso 7. USE de la máquina

**🎯 Problema.** RED mira el servicio desde afuera. Cuando RED muestra un problema, hace falta mirar los recursos de la máquina para saber si la causa está ahí. USE ordena esa revisión en utilización, saturación y errores.

**👵 Analogía.** Además de los medidores de cada puesto, el mercado tiene los de la instalación. Cuánto del caudal de la cañería se está usando, cuánta agua queda en el estanque y cuánta gente espera turno en la llave común.

**🔮 Predicción.** Antes de ejecutar la carga por núcleo, preguntar qué valor significa que la máquina está saturada. La respuesta es sobre 1. Hay más procesos esperando CPU que núcleos para atenderlos.

**💻 Comando.**

```promql
1 - avg(rate(node_cpu_seconds_total{mode="idle"}[5m]))
node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes
sum(node_load1) / count(node_cpu_seconds_total{mode="idle"})
```

| Parte | Qué es |
|---|---|
| `mode="idle"` | Segundos que cada núcleo pasó sin hacer nada |
| `1 - avg(...)` | La fracción de tiempo ocupado, promediada entre núcleos |
| `MemAvailable` sobre `MemTotal` | Fracción de memoria que se puede usar sin sacar a nadie |
| `node_load1` | Promedio de procesos listos o esperando en el último minuto |
| `count(...{mode="idle"})` | Cuántos núcleos hay, una serie idle por núcleo |

**⚙️ Técnico.** node_exporter corre dentro de la máquina virtual de Docker Desktop, así que mide esa máquina y no el computador del alumno. Los núcleos y la memoria son los que tiene asignados Docker. `sum(node_load1)` quita las etiquetas para que la división funcione contra `count`, que tampoco las tiene. Los errores de USE, como fallas de disco o de red, existen en node_exporter pero no se usan en esta práctica.

**📺 Salida.** Tres cuadros con un solo valor cada uno. La CPU ocupada suele estar entre 0.05 y 0.2. La memoria disponible entre 0.4 y 0.7. La carga por núcleo bajo 0.5.

**⚠️ Fallas.**

| Qué se ve | Causa | Arreglo |
|---|---|---|
| La división de carga sale vacía | Se escribió `node_load1` sin `sum` | Las etiquetas no coinciden. Agregar `sum` |
| La memoria disponible es muy baja | Docker Desktop tiene poca memoria asignada | Subirla en la configuración de Docker Desktop |
| La CPU da números mayores que 1 | Se usó `sum` en vez de `avg` | Usar `avg` |

---

## Paso 8. Caos de latencia

**🎯 Problema.** Un problema que afecta a una parte de los clientes no se ve en el promedio ni en la mediana. Hay que saber detectarlo solo con las consultas, sin mirar logs ni preguntar a nadie.

**👵 Analogía.** Dos de cada diez clientes del puesto esperan cinco minutos más en la fila. El puestero dice que el tiempo típico de atención sigue igual, y tiene razón. Pero los que esperan se van a quejar. La cola de la distribución es donde viven los reclamos.

**🔮 Predicción.** Antes de mirar los gráficos, preguntar cuánto van a subir el p95 y el p50 con un 20 % de peticiones 300 ms más lentas. El p95 sube a unos 300 ms. El p50 casi no se mueve.

**💻 Comando.**

```bash
bin/caos.sh pedidos latencia ms=300 porcentaje=20 duracion_s=900
bin/caos.sh pedidos latencia off
```

```promql
histogram_quantile(0.50, sum(rate(http_server_request_duration_seconds{job="pedidos", ambiente="prod"}[5m])))
```

| Parte | Qué es |
|---|---|
| `pedidos latencia` | Servicio y tipo de falla |
| `ms=300` | Demora agregada a cada petición afectada |
| `porcentaje=20` | Fracción de peticiones que se demoran |
| `duracion_s=900` | La falla se apaga sola a los 15 minutos si nadie la apaga |
| `off` | Apaga la falla de inmediato |

**⚙️ Técnico.** La falla vive en memoria del proceso y la expone en `chaos_active{type="latencia"}`. Con una ventana de 5 minutos, el p95 empieza a subir cuando más del 5 % de las muestras de la ventana son lentas. Con un 20 % afectado eso ocurre en poco más de un minuto. El histograma nativo ubica bien los 300 ms. El clásico los pone en algún punto entre 0.25 y 0.5 por interpolación.

**📺 Salida.** `bin/caos.sh` muestra la tabla con latencia ACTIVA. El gráfico de p95 pasa de unos 0.007 a cerca de 0.3. El de p50 sube apenas unas décimas de milisegundo.

**⚠️ Fallas.**

| Qué se ve | Causa | Arreglo |
|---|---|---|
| El p95 no sube | Se miró antes de 2 minutos | Esperar y volver a pulsar Execute |
| 401 o acceso rechazado | El token de caos de `infra/.env` no coincide | Revisar `CAOS_TOKEN` en `infra/.env` |
| El p95 sigue alto después de apagar | La ventana de 5 minutos todavía contiene muestras lentas | Esperar 5 minutos |

---

## Paso 9. La bomba de cardinalidad

**🎯 Problema.** Cada combinación distinta de nombre y etiquetas es una serie, y cada serie ocupa memoria en Prometheus. Si una etiqueta toma valores sin límite, como un identificador de cliente o una ruta real, la cantidad de series crece con el tráfico hasta tumbar a Prometheus.

**👵 Analogía.** El mercado lleva un cuaderno por producto. Un día alguien decide abrir un cuaderno nuevo por cada cliente. A fin de mes la bodega está llena de cuadernos con una sola línea escrita. Eso es la cardinalidad.

**🔮 Predicción.** Antes de lanzar la ráfaga, preguntar cuántas series nuevas va a crear. La mayoría dice 200. Son unas 3200, 16 por cada sku, porque cada ruta nueva crea su contador, su `_created` y las 14 series del histograma.

**💻 Comando.**

```promql
prometheus_tsdb_head_series
count({job="catalogo", ambiente="prod"})
sort_desc(count by (job) ({__name__=~".+"}))
topk(5, count by (__name__) ({job="catalogo"}))
count by (route) (http_server_requests_total{job="catalogo", ambiente="prod"})
```

```bash
bin/caos.sh catalogo cardinalidad
Capitulo3/rafaga-skus.sh
bin/caos.sh catalogo cardinalidad off
docker restart gpe-catalogo
```

| Parte | Qué es |
|---|---|
| `prometheus_tsdb_head_series` | Series que Prometheus tiene en memoria, en su bloque de cabecera |
| `{__name__=~".+"}` | Todas las series de todas las métricas |
| `count by (__name__)` | Cuenta series agrupando por nombre de métrica |
| `cardinalidad` | Falla que pone la ruta real en la etiqueta `route` |
| `rafaga-skus.sh` | 200 peticiones a 20 skus que existen y 180 que no, distintos en cada corrida |

**⚙️ Técnico.** La librería de Python guarda cada serie mientras el proceso vive. Apagar la falla deja de crear series nuevas, pero las ya creadas siguen saliendo en `/metrics` hasta reiniciar catalogo. Al reiniciar, el siguiente scrape ya no las trae y Prometheus las marca como vencidas, así que `count` vuelve a la normalidad enseguida. Pero siguen ocupando memoria en la cabecera hasta que Prometheus compacta ese bloque, lo que tarda entre 2 y 3 horas. Por eso la ráfaga elige skus inexistentes nuevos en cada corrida. Con skus repetidos, sus series ya estarían en la cabecera y `prometheus_tsdb_head_series` no subiría.

**📺 Salida.** Antes de la ráfaga, catalogo prod tiene unas 80 series. Después tiene más de 3000 y `prometheus_tsdb_head_series` sube en casi la misma cantidad. Si en las últimas 3 horas ya se corrió la ráfaga, sube unas 2900, porque las series de los 20 skus que existen ya estaban en la cabecera. `topk` pone primero a `http_server_request_duration_seconds_bucket` con cerca de 2000. `count by (route)` devuelve más de 200 rutas, una por sku. Al reiniciar, catalogo vuelve a unas 80 y la cabecera sigue alta.

**⚠️ Fallas.**

| Qué se ve | Causa | Arreglo |
|---|---|---|
| La ráfaga no crea series | La falla no estaba encendida | `bin/caos.sh estado` y encenderla |
| `prometheus_tsdb_head_series` no sube enseguida | Prometheus se raspa a sí mismo cada 15 segundos y todavía no contó las series nuevas | Esperar 15 segundos y pulsar Execute otra vez |
| catalogo sigue con miles de series | Se apagó la falla pero no se reinició | `docker restart gpe-catalogo` |
| La consulta por job tarda | `{__name__=~".+"}` recorre todas las series | Es esperado en un Prometheus grande. Aquí tarda menos de un segundo |

---

## Paso 10. Guardar las consultas y verificar

**🎯 Problema.** Las consultas que se escriben en una clase se pierden al cerrar el navegador. Dejarlas en un archivo permite revisarlas, reutilizarlas en la Práctica 4 y comprobar que funcionan.

**👵 Analogía.** Al cierre, cada puestero deja en el libro de la administración cómo leyó cada medidor. Al día siguiente otro puede repetir la lectura igual.

**🔮 Predicción.** Antes del Enter, preguntar qué pregunta creen que va a fallar. La que más falla es la 9, cuando se copia sin `or vector(0)`.

**💻 Comando.**

```bash
Capitulo3/verificar.sh
```

| Parte | Qué es |
|---|---|
| `Capitulo3/verificar.sh` | Lee las 20 consultas de `consultas.md`, revisa que cada una use lo que su pregunta pide, la ejecuta contra Prometheus y revisa el caos y las series de catalogo |

**⚙️ Técnico.** El script toma cada bloque `promql` y lo une en una sola línea, así que una consulta de varias líneas funciona. Si un bloque no tiene lo mínimo de su pregunta, por ejemplo `resets(` en la 5, falla sin ejecutarla, para que una consulta cualquiera que devuelva datos no pase. La revisión de series acepta menos de 200 en catalogo prod. No usa python3 ni jq.

**📺 Salida.** Veinte líneas de preguntas en verde, dos de estado del stack y PRÁCTICA LOGRADA 22 de 22 verificaciones en verde.

**⚠️ Fallas.**

| Qué se ve | Causa | Arreglo |
|---|---|---|
| Pregunta N sin respuesta | El bloque está vacío o se escribió fuera de él | La consulta va entre la línea `promql` y la que cierra |
| Pregunta 9 no devuelve datos | Falta `or vector(0)` | Agregarlo al numerador |
| Pregunta N tiene un error de sintaxis | Comillas tipográficas o paréntesis sin cerrar | Copiarla de nuevo desde Prometheus |
| catalogo en prod tiene miles de series | No se reinició catalogo | `docker restart gpe-catalogo` y esperar 30 segundos |

---

## ❓ Preguntas del alumno

Son preguntas de un alumno de nivel intermedio, que maneja la terminal y Docker básico pero no conoce Prometheus ni Grafana.

**¿Qué es Prometheus dentro de este stack?**
Es un contenedor que cada 15 segundos pide `/metrics` a cada servicio y guarda los números con su hora. Lo que se escribe en **Query** se ejecuta sobre esos datos guardados.

**¿Qué es `gpe-pedidos` en `docker restart gpe-pedidos`?**
Es el nombre del contenedor donde corre pedidos. Cada servicio vive en su propio contenedor con el prefijo `gpe-`, y reiniciarlo vuelve a levantar el proceso con la memoria vacía. Por eso sus contadores parten de cero.

**¿Qué es un puerto y por qué catalogo usa el 8001?**
Es el número por el que un contenedor publica un servicio hacia el computador. catalogo publica sus métricas en el 8001, pedidos en el 8002 y Prometheus en el 9090. Si en la máquina son otros, `bin/estado.sh` muestra la tabla real.

**¿Qué es una etiqueta?**
Un par nombre y valor que acompaña a cada serie, como `job="pedidos"` o `status="201"`. Sirve para filtrar y agrupar. Cada valor distinto crea una serie aparte, que es lo que explota en la bomba de cardinalidad.

**¿Por qué no veo datos después de reiniciar un servicio?**
Porque el servicio acaba de nacer y Prometheus todavía no hace el siguiente scrape, o porque nadie ha pedido esa ruta aún. Se esperan 15 segundos y se repite. Si sigue vacío, revisar el puerto con `bin/estado.sh`.

**¿Por qué la guía pide esperar 2 minutos antes de mirar un gráfico?**
`rate` y `histogram_quantile` trabajan sobre una ventana de 5 minutos y necesitan varias muestras nuevas para reflejar un cambio. Antes de eso la ventana todavía está dominada por los datos viejos.

**¿Por qué `rate` y no simplemente la diferencia entre dos valores?**
Porque la diferencia no sabe de reinicios y depende del momento exacto de las dos muestras. `rate` usa todas las muestras de la ventana, corrige los reinicios y extrapola a los bordes.

**¿Qué ventana uso, `[1m]` o `[5m]`?**
Al menos cuatro veces el intervalo de scrape. Una ventana corta reacciona rápido pero tiene ruido, una larga es suave pero tarda en mostrar un cambio. En Grafana conviene `$__rate_interval`, que se ve en la Práctica 4.

**¿Por qué el p95 de catalogo da justo bajo 5 ms?**
Porque casi todo cae en el primer bucket, de 0 a 5 ms, y `histogram_quantile` interpola de forma lineal dentro de él. El histograma clásico no puede decir más que eso. Con buckets más finos o un histograma nativo se vería el valor real.

**¿Por qué no usar siempre histogramas nativos?**
Necesitan una librería cliente que los soporte, el formato protobuf y un Prometheus configurado para leerlos. En este stack eso ya está hecho con `scrape_native_histograms`. Muchas herramientas y dashboards todavía esperan las series `_bucket`, por eso pedidos publica las dos.

**¿Cuándo tiene sentido un summary?**
Cuando el percentil se necesita exacto, en una sola instancia, y nunca se va a agregar. Es raro. En casi todos los casos un histograma es mejor.

**¿Cómo se evita una bomba de cardinalidad en producción?**
Usando plantillas de ruta y no rutas reales, nunca poniendo identificadores de usuario o de pedido en etiquetas, y fijando límites. Prometheus admite `sample_limit` y `label_limit` por job, que descartan el scrape completo si se superan.

**¿Por qué `count by (job)` no muestra a pagos con muchas series?**
pagos manda sus métricas por OTLP y no tiene job de scrape, pero sus series sí llevan `job="pagos"`. Aparece en la lista con menos series porque expone menos métricas.

**¿La ráfaga dejó algo roto?**
No. Al apagar la falla y reiniciar catalogo todo vuelve a su forma normal. Lo único que queda es memoria ocupada en Prometheus durante unas horas, que se libera sola.
