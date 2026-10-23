# Guía del relator. Práctica 1. Mapa de señales y comparación de herramientas para un caso real

Capítulo 1 del temario. Duración provisoria de 40 minutos.

La práctica tiene una sola idea. El modelo de entrega de una métrica no se elige por gusto, lo decide la forma en que vive el componente. El alumno primero decide en papel y después descubre que el stack ya tomó esas mismas decisiones.

## Diagrama

![diagrama](../images/1/diagrama.png)

La fuente editable está en `images/1/diagrama.mmd` y se vuelve a dibujar con `tools/diagramas/render.sh 1`.

## Familia de analogías

Toda la práctica usa el propio tianguis. No mezclar con otras analogías.

| Concepto | En el tianguis |
|---|---|
| Métricas | El contador de la caja del puesto |
| Logs | La libreta del puestero |
| Trazas | Seguir a un cliente de puesto en puesto |
| Pull | El inspector que pasa por cada puesto a preguntar |
| Push | El puestero que va a dejar su reporte a la oficina |
| Pushgateway | El buzón de la oficina donde el ambulante deja su reporte antes de irse |

## Reparto del tiempo

| Bloque | Minutos |
|---|---|
| Preparar el punto de partida | 5 |
| Conocer la tienda | 5 |
| Completar el mapa de señales | 15 |
| Contrastar con la plataforma real | 10 |
| Verificar y cerrar | 5 |

## Antes de la clase

- Correr `Capitulo1/preparar.sh` en la máquina del relator y en la del alumno. La primera vez descarga y construye imágenes y puede tardar más de 10 minutos.
- Confirmar que `bin/estado.sh` muestra los 18 servicios en healthy.
- Tener abierto `Capitulo1/solucion/mapa-de-senales.md` en una ventana que el alumno no vea.

---

## Paso 1. Preparar el punto de partida

**🎯 Problema.** Si el alumno llega a la pantalla de Prometheus sin tráfico, pagos todavía no cobró nada y conciliacion todavía no corrió. Las dos sorpresas de la práctica no aparecen y la clase se queda sin remate.

**👵 Analogía.** Antes de recorrer el tianguis hay que esperar a que los puestos abran y entre la primera clientela. A un tianguis vacío no hay nada que preguntarle.

**🔮 Predicción.** Preguntar antes del Enter. ¿Cuántos contenedores creen que hacen falta para una tienda de tres microservicios con su observabilidad completa? La respuesta es 18.

**💻 Comando.**

```bash
Capitulo1/preparar.sh
```

| Parte | Qué es |
|---|---|
| `Capitulo1/preparar.sh` | Script de la práctica. Se corre desde la raíz del repositorio, sin argumentos |
| `bin/up.sh` | Lo llama por dentro. Levanta el proyecto de Compose `gpe` y espera a que todo esté healthy |
| `bin/trafico.sh nivel normal` | Lo llama por dentro. Deja a k6 con 5 clientes |
| `bin/conciliar.sh` | Lo llama solo si conciliacion todavía no dejó nada en el Pushgateway |

**⚙️ Técnico.** El script no termina hasta que Prometheus responde dos consultas con datos, `payments_processed_total` y `conciliacion_last_run_success`. Espera hasta 120 segundos. Usa las funciones de `_comun/lib-practicas.sh`, que leen puertos y credenciales de `infra/.env`.

**📺 Salida.** Dos líneas con flecha azul, un OK verde con el texto Punto de partida de la Práctica 1 listo y las direcciones de Prometheus y del Pushgateway.

**⚠️ Fallas.**

| Qué se ve | Causa | Arreglo |
|---|---|---|
| PARO El stack no levantó | Un puerto ocupado o Docker apagado | Correr `bin/up.sh` y leer su mensaje. Si es un puerto, cambiarlo en `infra/.env` |
| PARO Pasaron 120s y Prometheus no tiene esas métricas | El tráfico está pausado o pagos no arrancó | `bin/trafico.sh estado` y `bin/estado.sh` |
| Las direcciones no son 9090 ni 9091 | `infra/.env` tiene otros puertos | Usar las que imprime el script. Es correcto |

---

## Paso 2. Mirar el diagrama de arquitectura de Tianguis

**🎯 Problema.** Quien instrumenta sin mirar la arquitectura termina midiendo todo igual. Un proceso que vive milisegundos no se puede medir como un servicio que vive todo el día.

**👵 Analogía.** En el tianguis hay puestos fijos, que están desde que abre hasta que cierra, y hay un ambulante que pasa, vende y se va. Al inspector le sirve saber quién es quién antes de salir a recorrer.

**🔮 Predicción.** Preguntar antes de mostrar la ficha. De estos cinco componentes, ¿cuál creen que va a ser el más difícil de medir y por qué? Dejar que respondan. Casi todos dicen pagos por ser Java. La respuesta que interesa es conciliacion, por lo poco que vive.

**💻 Comando.** Este paso no tiene comando. El alumno lee el diagrama y la ficha de la guía.

| Elemento del diagrama | Qué mirar |
|---|---|
| Flechas llenas dentro de la tienda | Quién llama a quién. pagos depende de pedidos y pedidos depende de catalogo |
| conciliacion | No recibe tráfico. Sale a consultar a pedidos y a pagos |
| k6 | Está fuera de la tienda. Es la clientela simulada |
| Flecha punteada con pregunta | Es la pregunta de la práctica. Todavía no se responde |
| Plataforma | Prometheus guarda métricas, Loki guarda logs, Tempo guarda trazas y Grafana consulta a los tres |

**⚙️ Técnico.** catalogo usa la librería cliente de Prometheus para Python y pedidos la de Go. pagos no tiene ninguna librería de métricas en su código, lleva el agente de OpenTelemetry para Java, que instrumenta por fuera. conciliacion es un planificador que lanza una corrida cada 5 minutos, y cada corrida empuja su resultado antes de terminar.

**📺 Salida.** No hay salida en pantalla. El alumno debe poder decir en voz alta qué componentes viven todo el día y cuál no.

**⚠️ Fallas.**

| Qué se ve | Causa | Arreglo |
|---|---|---|
| El alumno confunde k6 con un servicio de la tienda | El diagrama lo muestra al mismo nivel | Aclarar que es la clientela. No es parte del negocio |
| El alumno quiere abrir Grafana ya | Ansiedad por ver pantallas | Recordar que la práctica pide decidir antes de mirar |

---

## Paso 3. Completar la Tabla 1 del mapa de señales

**🎯 Problema.** Sin un mapa, cada equipo manda lo que se le ocurre por el camino que se le ocurre. Después nadie sabe por qué una métrica no aparece o por qué un servicio no tiene `up`.

**👵 Analogía.** El contador de la caja dice cuánto se vendió, eso es la métrica. La libreta del puestero cuenta qué pasó con cada venta, eso es el log. Seguir a un cliente de puesto en puesto es la traza. Para la entrega hay dos caminos. O el inspector pasa por el puesto a preguntar, que es pull, o el puestero camina hasta la oficina a dejar su reporte, que es push. El ambulante no puede esperar al inspector, así que deja su reporte en el buzón de la oficina, que es el Pushgateway.

**🔮 Predicción.** Preguntar antes de que escriban la fila de conciliacion. Si el inspector pasa cada 15 segundos y el ambulante está en el tianguis menos de un segundo, ¿cuántas veces lo va a encontrar?

**💻 Comando.** No hay comando. El alumno edita `Capitulo1/mapa-de-senales.md`.

| Columna | Qué se espera |
|---|---|
| Métricas, Logs, Trazas | sí o no. Puede seguir con una aclaración después |
| Modelo de entrega de las métricas | pull, push OTLP, Pushgateway o ninguno |
| Por qué | Una frase que relacione la forma de vivir del componente con el modelo elegido |

Respuestas de referencia.

| Componente | Métricas | Logs | Trazas | Modelo |
|---|---|---|---|---|
| catalogo | sí | sí | no | pull |
| pedidos | sí | sí | no | pull |
| pagos | sí | sí | sí | push OTLP |
| conciliacion | sí | sí | no | Pushgateway |
| k6 | no | sí | no | ninguno |

**⚙️ Técnico.** Pull le da a Prometheus una métrica gratis, `up`, que vale 1 si el destino contestó y 0 si no. Con push esa señal no existe y la ausencia de datos hay que detectarla de otra manera. pagos usa push porque el agente de OpenTelemetry exporta por OTLP y Prometheus 3 trae un receptor OTLP nativo. conciliacion usa el Pushgateway porque es el único caso que la documentación de Prometheus da por válido, un proceso por lotes a nivel de servicio.

**📺 Salida.** La tabla con las cinco filas completas. La verificación revisa que ninguna celda quede vacía, que las tres primeras columnas empiecen con sí o no y que el modelo de entrega de catalogo, pedidos, pagos y conciliacion sea el esperado.

**⚠️ Fallas.**

| Qué se ve | Causa | Arreglo |
|---|---|---|
| El alumno pone pull en pagos | Asume que todo servicio HTTP publica `/metrics` | No corregir todavía. El Paso 5 lo va a desmentir solo |
| El alumno pone push en conciliacion sin más | No distingue push directo de Pushgateway | Preguntar quién guarda el dato cuando el proceso ya terminó |
| El alumno borra una columna o cambia el nombre de una fila | Edición descuidada de la tabla | `git checkout -- Capitulo1/mapa-de-senales.md` y volver a llenar |
| El alumno escribe sí en métricas de k6 | k6 calcula métricas propias | Aceptar la discusión. En este stack k6 no las envía a ningún lado |

---

## Paso 4. Completar la tabla de comparación de herramientas

**🎯 Problema.** Elegir la herramienta por moda sale caro. Cada una nació con un modelo de datos y un modelo de entrega distintos, y eso define qué preguntas se pueden hacer después.

**👵 Analogía.** Hay oficinas de tianguis que mandan inspectores y oficinas que solo reciben reportes en ventanilla. Hay oficinas que archivan por puesto y pasillo, y otras que archivan con etiquetas sueltas como giro, dueño y zona. Con el mismo tianguis, cada oficina puede contestar preguntas distintas.

**🔮 Predicción.** Preguntar antes de que llenen la fila de Graphite. Si el nombre de la métrica es `tienda.catalogo.prod.peticiones`, ¿cómo le piden las peticiones de todos los ambientes juntos?

**💻 Comando.** No hay comando. El alumno sigue en `Capitulo1/mapa-de-senales.md`.

| Columna | Qué se espera |
|---|---|
| Modelo de datos | Cómo se identifica una serie. Etiquetas, jerarquía con puntos o campos |
| Entrega | Pull, push o los dos |
| Consulta | El lenguaje. PromQL, funciones de Graphite, InfluxQL, SQL o Flux |
| Cuándo la elegiría | Un caso concreto. No vale escribir que depende |

**⚙️ Técnico.** Prometheus identifica cada serie por nombre y etiquetas, raspa por HTTP y desde la versión 3 también recibe OTLP. Graphite recibe por push en Carbon y nombra con jerarquía de puntos. InfluxDB recibe por push con su protocolo de línea y separa etiquetas de campos. Un backend compatible con OpenTelemetry no es un producto, es cualquier destino que hable OTLP, entre ellos el propio Prometheus, Mimir o Tempo.

**📺 Salida.** Cuatro filas completas. La verificación solo revisa que no haya celdas vacías. El contenido lo evalúa el relator contra `Capitulo1/solucion/mapa-de-senales.md`.

**⚠️ Fallas.**

| Qué se ve | Causa | Arreglo |
|---|---|---|
| El alumno escribe que Prometheus solo hace pull | Conocimiento de versiones anteriores | Mostrar la línea `--web.enable-otlp-receiver` en `infra/compose.yaml` |
| El alumno trata OpenTelemetry como una base de datos | Confunde el estándar con el almacenamiento | Aclarar que OTel define cómo se instrumenta y cómo viaja el dato. Guardarlo es tarea del backend |
| La columna Cuándo la elegiría queda genérica | Falta de caso | Pedir un ejemplo de su propio trabajo |

---

## Paso 5. Abrir Prometheus en Status, Target health

**🎯 Problema.** Un mapa en papel puede estar equivocado sin que nadie lo note. La lista de destinos de Prometheus es la verdad sobre a quién visita, y todo lo que no esté ahí llega por otro camino o no llega.

**👵 Analogía.** Esta pantalla es la lista de puestos que el inspector visita en su ronda. Si un puesto no está en la lista, el inspector nunca pasó por ahí. Y aun así en la oficina hay reportes de ese puesto, porque el puestero los fue a dejar caminando.

**🔮 Predicción.** Preguntar antes de abrir la pantalla. ¿Cuántos destinos va a ver? ¿Aparece pagos? Anotar las respuestas en voz alta. La sorpresa es que pagos no está y aun así `payments_processed_total` existe.

**💻 Comando.** En la interfaz de Prometheus, menú **Status**, opción **Target health**. Después, en **Query**, dos consultas.

```promql
up{job="pagos"}
```

```promql
payments_processed_total
```

| Parte | Qué es |
|---|---|
| `up` | Métrica que Prometheus genera por cada destino que raspa. Vale 1 o 0 |
| `{job="pagos"}` | Selector de etiquetas. Deja solo las series cuyo job es pagos |
| `payments_processed_total` | Contador de cobros que publica pagos. El nombre original en OpenTelemetry es `payments.processed` |

**⚙️ Técnico.** Hay 12 destinos en 10 grupos, porque catalogo y pedidos tienen dos destinos cada uno, prod y dev. pagos exporta cada 15 segundos por HTTP a `/api/v1/otlp/v1/metrics`. Prometheus traduce el nombre, cambia el punto por guion bajo y agrega el sufijo `_total` por ser un contador. La etiqueta job sale del atributo de recurso `service.name`. Como nadie raspa a pagos, no existe `up{job="pagos"}`.

**📺 Salida.** En Target health, diez grupos con todos sus destinos en UP y ninguno llamado pagos. La primera consulta responde Empty query result. La segunda responde 8 series, una por cada combinación de método de pago y resultado que ya ocurrió.

**⚠️ Fallas.**

| Qué se ve | Causa | Arreglo |
|---|---|---|
| La página no abre | El puerto de Prometheus no es 9090 en esa máquina | Usar la dirección que imprimió `Capitulo1/preparar.sh` |
| Un destino aparece en DOWN | Un contenedor se cayó o quedó detenido de otra práctica | `bin/estado.sh` y después `bin/up.sh` |
| `payments_processed_total` devuelve vacío | Todavía no hubo cobros | `bin/trafico.sh estado`. Si está pausado, `bin/trafico.sh reanudar` y esperar 30 segundos |
| Aparecen menos de 8 series | El stack lleva poco tiempo arriba y alguna combinación todavía no ocurrió | Es correcto. Seguir |

---

## Paso 6. Abrir el Pushgateway y encontrar el grupo de conciliacion

**🎯 Problema.** Un proceso que vive milisegundos muere antes de que alguien lo raspe. Sin un lugar donde dejar su resultado, sus métricas se pierden y nadie sabe si la última corrida salió bien.

**👵 Analogía.** El Pushgateway es el buzón de la oficina. El ambulante deja su reporte antes de irse y el inspector, que sí pasa por la oficina en cada ronda, lo recoge de ahí. El buzón guarda el último reporte aunque el ambulante no vuelva nunca más.

**🔮 Predicción.** Preguntar antes de abrir el grupo. Si conciliacion deja de correr hoy, ¿qué va a mostrar el Pushgateway mañana?

**💻 Comando.** Abrir el Pushgateway en el navegador y hacer clic en el grupo `job="conciliacion"`.

| Elemento de la pantalla | Qué es |
|---|---|
| `job="conciliacion"` | La clave de agrupación. Todo lo que empuja el mismo job reemplaza lo anterior de ese grupo |
| `conciliacion_last_run_success` | 1 si la última corrida terminó bien y 0 si falló |
| `conciliacion_last_success_timestamp_seconds` | Cuándo fue la última corrida exitosa |
| `push_time_seconds` | La agrega el Pushgateway. Es la hora del último empuje que aceptó |
| last pushed | La hora en que llegó cada métrica |

**⚙️ Técnico.** El Pushgateway es un destino más de Prometheus, con `honor_labels: true` para que la etiqueta job que trae cada métrica no sea reemplazada por la del scrape. Prometheus raspa el Pushgateway cada 15 segundos y siempre encuentra el último valor, sea de hace un minuto o de hace un mes. Por eso la respuesta a la predicción es incómoda. Mañana el Pushgateway va a mostrar lo mismo que hoy y nada se va a poner en rojo. Lo único que delata un job detenido es `time() - conciliacion_last_success_timestamp_seconds`, que no para de crecer.

**📺 Salida.** Un grupo con 11 métricas. Nueve son de conciliacion, incluida `chaos_active`, y dos las agrega el Pushgateway, `push_time_seconds` y `push_failure_time_seconds`.

**⚠️ Fallas.**

| Qué se ve | Causa | Arreglo |
|---|---|---|
| El Pushgateway aparece vacío | conciliacion todavía no corrió | `bin/conciliar.sh` |
| El alumno pulsa Delete Group | Curiosidad | `bin/conciliar.sh` vuelve a llenar el grupo |
| El alumno cree que el Pushgateway sirve para cualquier servicio | Generaliza el caso | Recordar que guarda el último valor para siempre. Un servicio caído seguiría pareciendo vivo |

---

## Paso 7. Verificar

**🎯 Problema.** Sin una revisión objetiva, el alumno no sabe si terminó y el relator tiene que leer cada tabla a mano.

**👵 Analogía.** Es el inspector jefe revisando que el mapa del tianguis no tenga puestos sin anotar.

**🔮 Predicción.** Preguntar antes del Enter. ¿Cuántas líneas van a salir en rojo? Que cada uno diga un número.

**💻 Comando.**

```bash
Capitulo1/verificar.sh
```

| Parte | Qué es |
|---|---|
| `Capitulo1/verificar.sh` | Lee `Capitulo1/mapa-de-senales.md` y revisa 14 puntos. No recibe argumentos |
| Código de salida | 0 si todo está en verde y 1 si falta algo |

**⚙️ Técnico.** El script no consulta el stack, solo lee el archivo. Ubica cada fila por el texto de su primera celda, sin distinguir mayúsculas, y cuenta celdas vacías. En el modelo de entrega busca las palabras pull, push y otlp, o pushgateway, dentro de la celda. Tolera fin de línea de Windows.

**📺 Salida.** Catorce líneas con OK en verde y al final PRÁCTICA LOGRADA 14 de 14 verificaciones en verde. Si falta algo, la línea sale con FALTA en rojo y una pista debajo.

**⚠️ Fallas.**

| Qué se ve | Causa | Arreglo |
|---|---|---|
| No encuentro la fila | Se cambió el nombre de la primera celda | Devolver el nombre original, por ejemplo `conciliacion` sin acento |
| Tiene celdas vacías aunque se ven llenas | Se borró una barra vertical de la tabla | Revisar que cada fila tenga la misma cantidad de barras que el encabezado |
| Modelo de entrega de pagos en rojo | La celda dice solo push o solo OTLP | Escribir push OTLP |
| Permission denied al ejecutar | El archivo perdió el permiso de ejecución | `bash Capitulo1/verificar.sh` |

---

## ❓ Preguntas del alumno

Son preguntas de un alumno de nivel intermedio, que maneja la terminal y Docker básico pero no conoce Prometheus ni Grafana.

**¿Qué es un contenedor y por qué hay tantos?**
Un contenedor es un proceso aislado que corre desde una imagen con todo lo que necesita. Cada servicio de la tienda y cada herramienta de la plataforma corre en el suyo, y Compose levanta los 18 juntos en el proyecto `gpe`.

**¿Por qué `preparar.sh` tarda tanto la primera vez?**
Descarga las imágenes y construye las de la tienda. Después espera a que todo esté healthy y a que Prometheus tenga datos de pagos y de conciliacion. Las siguientes veces es mucho más rápido.

**¿Qué es un puerto y por qué Prometheus está en el 9090?**
Un puerto es el número con que la máquina distingue a cada servicio que escucha en la red. 9090 es el de Prometheus por defecto y 9091 el del Pushgateway. `infra/.env` puede cambiarlos y el script imprime los que quedaron.

**¿Qué es una etiqueta, como `job`?**
Es un par de nombre y valor que acompaña a cada serie. Dos series con el mismo nombre de métrica y distintas etiquetas son series distintas. `job` dice de qué componente viene el dato.

**¿Por qué una consulta no muestra datos?**
Puede que todavía no haya habido tráfico, que el nombre esté mal escrito o que nadie envíe esa métrica. Revisar `bin/trafico.sh estado` y esperar unos segundos, porque Prometheus raspa cada 15 segundos.

**¿Por qué pagos no usa también pull, si Java tiene librería cliente de Prometheus?**
Podría. Se eligió el agente de OpenTelemetry porque instrumenta sin tocar el código y entrega métricas y trazas con las mismas convenciones. El costo es perder `up`.

**Si pagos no tiene `up`, ¿cómo me entero de que se cayó?**
Con una alerta por ausencia, por ejemplo `absent(payments_processed_total)`, o midiendo la antigüedad de la última muestra. Se retoma en la Práctica 5, que trata las alertas.

**¿Por qué las métricas de pagos no pasan por el OpenTelemetry Collector si las trazas sí?**
Para mostrar los dos caminos. Prometheus 3 recibe OTLP de forma nativa, así que el Collector es opcional para métricas. En producción suele usarse igual, para filtrar, agrupar y reintentar.

**¿El Pushgateway no es un punto único de falla?**
Sí, y además no caduca nada solo. Por eso la documentación lo limita a procesos por lotes a nivel de servicio. Para todo lo demás se prefiere pull o push OTLP.

**¿Qué pasa con las métricas de pagos si Prometheus se reinicia?**
El agente reintenta durante un rato y después descarta. Se pierde ese tramo. Con pull pasa algo parecido, se pierden los scrapes de ese intervalo, pero los contadores siguen acumulando en el servicio y `rate` lo compensa.

**¿Por qué catalogo y pedidos no tienen trazas?**
Es una decisión del curso para tener los dos mundos lado a lado. En un sistema real convendría instrumentarlos con OpenTelemetry para ver la traza completa desde pagos hasta catalogo.

**¿k6 no debería mandar sus métricas también?**
Puede hacerlo por escritura remota o por OTLP. Aquí no lo hace para que la carga se mida donde importa, en los servicios que la reciben.

**¿OTLP reemplaza al formato de exposición de Prometheus?**
No. Conviven. OTLP es un protocolo de envío y el formato de exposición es lo que se lee al raspar. Prometheus entiende los dos y guarda todo en el mismo modelo de series con etiquetas.
