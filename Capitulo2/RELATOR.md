# Guía del relator. Práctica 2. Stack de Prometheus y Grafana con Docker Compose

Capítulo 2 del temario. Duración provisoria de 90 minutos.

La práctica tiene tres ideas. Prometheus decide a quién visita y cada cuánto. Cambiar esa decisión es editar un archivo, validarlo y recién después aplicarlo. Y Grafana no guarda datos, solo le pregunta a Prometheus.

## Diagrama

![diagrama](../images/2/diagrama.png)

La fuente editable está en `images/2/diagrama.mmd` y se vuelve a dibujar con `tools/diagramas/render.sh 2`.

## Familia de analogías

Toda la práctica usa la ronda del inspector del tianguis. No mezclar con otras analogías.

| Concepto | En la ronda del inspector |
|---|---|
| `scrape_interval` | Cada cuánto pasa el inspector |
| targets | La lista de puestos que visita |
| `up` | Si el puesto contestó cuando pasó |
| `relabel_configs` | La etiqueta que el inspector le pega al reporte antes de archivarlo |
| `promtool` | El jefe que revisa la ruta del inspector antes de mandarlo a la calle |
| Recarga con HUP | Le entregan la ruta nueva sin que deje de trabajar |

## Reparto del tiempo

| Bloque | Minutos |
|---|---|
| Levantar el stack | 10 |
| Encontrar el destino caído | 10 |
| Explorar las métricas | 10 |
| Leer la configuración | 10 |
| Etiqueta, promtool y recarga | 20 |
| Datasource de Grafana | 10 |
| Primer dashboard | 15 |
| Verificar y cerrar | 5 |

## Antes de la clase

- Correr `bin/up.sh` una vez en la máquina del alumno para que las imágenes ya estén descargadas.
- Confirmar que `git status` no muestra cambios en `infra/prometheus/prometheus.yml`. Si los hay, correr `Capitulo2/restaurar.sh`.
- Confirmar que en Grafana no existe un dashboard llamado Tianguis · Primer vistazo de una clase anterior.
- Tener a mano `Capitulo2/solucion/prometheus.yml` y `Capitulo2/solucion/tianguis-primer-vistazo.json`. El JSON se carga en Grafana desde **Dashboards**, **New**, **Import dashboard**.

---

## Paso 1. Levantar el stack y ver su estado

**🎯 Problema.** Diecisiete contenedores que dependen unos de otros no se pueden levantar a mano en el orden correcto, ni se puede saber a simple vista cuál no arrancó. Sin un comando único y una tabla de estado, la clase se va en diagnosticar Docker.

**👵 Analogía.** Antes de que el inspector salga a su ronda hay que abrir el tianguis. Se montan los puestos, se abre la oficina y se revisa puesto por puesto que haya alguien atendiendo.

**🔮 Predicción.** Después de `bin/up.sh` y de `Capitulo2/preparar.sh`, y antes del Enter de `bin/estado.sh`, preguntar. ¿Cuántos servicios van a estar en healthy? Casi todos dicen 18 porque lo acaban de ver. Son 17. `preparar.sh` detuvo uno a propósito y no lo anuncia.

**💻 Comando.**

```bash
bin/up.sh
Capitulo2/preparar.sh
bin/estado.sh
```

| Parte | Qué es |
|---|---|
| `bin/up.sh` | Crea `infra/.env` si no existe, revisa que los puertos estén libres, corre `docker compose up -d --build` y espera hasta 240 segundos a que cada healthcheck pase |
| `Capitulo2/preparar.sh` | Llama a `bin/up.sh`, deja el tráfico en nivel normal, corre `docker stop gpe-catalogo-dev` y espera a que Prometheus vea ese destino en 0 |
| `bin/estado.sh` | Tabla con servicio, puerto, estado y URL. Sale con código 0 solo si todos están en healthy |

**⚙️ Técnico.** El proyecto de Compose se llama `gpe` y todos los contenedores llevan ese prefijo. Cada servicio declara un healthcheck y `bin/estado.sh` lee su resultado con `docker inspect`. Todos los puertos escuchan solo en 127.0.0.1. Un contenedor detenido con `docker stop` no vuelve solo, porque la política de reinicio es `unless-stopped`. Ojo con el orden. Si el alumno corre `bin/up.sh` después de `preparar.sh`, Compose vuelve a encender catalogo-dev y el Paso 2 se queda sin destino caído.

**📺 Salida.** `bin/up.sh` termina con la tabla de 18 servicios en verde y la línea Los 18 servicios están healthy. `bin/estado.sh` muestra 17 en verde y catalogo-dev en rojo con el estado exited, y avisa Hay servicios que no están healthy.

**⚠️ Fallas.**

| Qué se ve | Causa | Arreglo |
|---|---|---|
| PARO Hay puertos en conflicto | Otro programa usa un puerto del stack | Cambiar ese puerto en `infra/.env` y volver a correr `bin/up.sh`. Nunca usar 5432 ni 8081 |
| PARO Docker no responde | Docker Desktop está cerrado | Abrir Docker Desktop y esperar a que arranque |
| Pasaron 240s y siguen sin estar healthy | Poca memoria asignada a Docker o primera construcción lenta | `docker compose -p gpe logs --tail 50 <servicio>` y volver a correr `bin/up.sh` |
| `bin/estado.sh` muestra los 18 en healthy | Se corrió `bin/up.sh` después de `preparar.sh` | Volver a correr `Capitulo2/preparar.sh` |
| A infra/.env le faltan variables | El repositorio se actualizó y la copia local quedó vieja | Copiar esas líneas desde `infra/.env.example` |

---

## Paso 2. Encontrar el destino caído y recuperarlo

**🎯 Problema.** Un servicio que deja de contestar no avisa. Si nadie pasa a preguntar, su ausencia se nota recién cuando un cliente reclama.

**👵 Analogía.** El inspector tiene su lista de puestos. Cuando pasa por uno y nadie contesta, anota un 0 en su planilla. Esa anotación es `up`. No es el puesto el que avisa que cerró, es el inspector el que lo descubre en su ronda.

**🔮 Predicción.** Preguntar antes de ejecutar `up == 0`. ¿Cuántas series va a devolver y con qué etiquetas? Después de `docker start`, preguntar cuánto va a tardar Prometheus en enterarse.

**💻 Comando.** En Prometheus, menú **Status**, opción **Target health**. Después en **Query**.

```promql
up == 0
```

```bash
docker start gpe-catalogo-dev
```

```promql
up{job="catalogo"}
```

| Parte | Qué es |
|---|---|
| `up` | Serie que Prometheus escribe en cada scrape, por cada destino. 1 si contestó y 0 si no |
| `== 0` | Filtro de comparación. Deja solo las series cuyo valor es 0 |
| `docker start` | Enciende un contenedor que ya existe y está detenido |
| `gpe-catalogo-dev` | Nombre del contenedor. El servicio de Compose se llama `catalogo-dev` |
| `{job="catalogo"}` | Selector. Trae los dos destinos del trabajo, prod y dev |

**⚙️ Técnico.** Con el contenedor detenido, Docker retira su nombre de la red interna. Por eso el error del scrape es no such host y no una conexión rechazada. El scrape siguiente a `docker start` puede tardar hasta 15 segundos, que es el `scrape_interval`. Durante el arranque el healthcheck todavía no pasó, pero `/metrics` ya responde, así que `up` puede volver a 1 antes de que `bin/estado.sh` diga healthy.

**📺 Salida.** En Target health, el grupo catalogo muestra 1 / 2 up, un destino en DOWN y un recuadro rojo con el error. `up == 0` devuelve una sola serie con `ambiente="dev"`, `instance="catalogo-dev:8000"` y `job="catalogo"`. Después de encender, `up{job="catalogo"}` devuelve dos series con valor 1.

**⚠️ Fallas.**

| Qué se ve | Causa | Arreglo |
|---|---|---|
| Todos los grupos están arriba | No se corrió `preparar.sh` o se corrió `bin/up.sh` después | `Capitulo2/preparar.sh` |
| `up == 0` devuelve vacío apenas se detuvo | Prometheus todavía no hizo el scrape siguiente | Esperar 15 segundos y pulsar Execute otra vez |
| `up{job="catalogo"}` sigue en 0 para dev | El contenedor está arrancando | Esperar 15 segundos más. Si sigue, `docker logs --tail 20 gpe-catalogo-dev` |
| Error response from daemon. No such container | El nombre está mal escrito | El nombre lleva el prefijo, `gpe-catalogo-dev` |

---

## Paso 3. Explorador de métricas, gauge y contador

**🎯 Problema.** Leer un contador como si fuera un valor del momento lleva a conclusiones absurdas, como que la CPU lleva usados 80 000 segundos. Antes de graficar hay que saber qué tipo de métrica se tiene delante.

**👵 Analogía.** El inspector anota dos clases de datos. Una es cuánta mercadería hay ahora en el puesto, que sube y baja. La otra es el contador de la caja, que solo suma desde que el puesto abrió. Para saber si hoy se vende mucho no sirve el número de la caja, sirve cuánto avanzó desde la ronda anterior.

**🔮 Predicción.** Preguntar antes de abrir el explorador con `node_cpu_seconds`. ¿Este valor puede bajar alguna vez? Y antes de graficar el `rate`, preguntar en qué modo va a estar casi toda la CPU.

**💻 Comando.** En **Query**, menú de tres puntos del cuadro de consulta, opción **Explore metrics**. Después estas consultas.

```promql
node_memory_MemAvailable_bytes
```

```promql
sum by (mode) (rate(node_cpu_seconds_total[5m]))
```

| Parte | Qué es |
|---|---|
| `node_memory_MemAvailable_bytes` | Gauge de node_exporter. Memoria disponible en bytes en el momento del scrape |
| `node_cpu_seconds_total` | Contador de node_exporter. Segundos de CPU acumulados, una serie por núcleo y por modo |
| `[5m]` | Selector de rango. Toma las muestras de los últimos 5 minutos |
| `rate(...)` | Crecimiento por segundo del contador en ese rango. Descuenta los reinicios |
| `sum by (mode)` | Suma todas las series y conserva solo la etiqueta `mode` |

**⚙️ Técnico.** El explorador lee los metadatos que cada destino publica en las líneas `# TYPE` y `# HELP` de su `/metrics`. El sufijo `_total` es la convención para contadores. El resultado del `rate` sobre segundos de CPU se lee como núcleos ocupados, y la suma de todos los modos da la cantidad de núcleos. node_exporter corre dentro de un contenedor, así que en Docker Desktop informa la máquina virtual de Docker y no el equipo anfitrión.

**📺 Salida.** El explorador marca `node_memory_MemAvailable_bytes` como gauge y `node_cpu_seconds_total` como counter. La primera consulta devuelve una serie con un número grande de bytes. El gráfico muestra una línea alta para `mode="idle"` y varias líneas cerca de cero para los demás modos.

**⚠️ Fallas.**

| Qué se ve | Causa | Arreglo |
|---|---|---|
| El explorador muestra la lista sin filtrar | El filtro tarda un instante en aplicar | Esperar o borrar y volver a escribir |
| El gráfico sale vacío | El stack lleva menos de un minuto arriba | Esperar. `rate` necesita al menos dos muestras dentro del rango |
| El alumno no encuentra el menú de tres puntos | Está dentro del cuadro de consulta, a la derecha | Mostrarlo en la captura 6 de la guía |
| La memoria no coincide con la del equipo | node_exporter mide la máquina virtual de Docker | Es correcto. Explicarlo |

---

## Paso 4. Leer prometheus.yml

**🎯 Problema.** Quien no sabe leer este archivo no puede explicar por qué una métrica tiene las etiquetas que tiene ni por qué un servicio no aparece. Toda la conducta de Prometheus sale de aquí.

**👵 Analogía.** Este archivo es la hoja de ruta del inspector. Arriba dice cada cuánto sale a caminar. Abajo está la lista de puestos, agrupados por pasillo. Un mismo pasillo puede tener dos puestos, y cada uno lleva anotado de qué lado está.

**🔮 Predicción.** Preguntar antes de abrir el archivo. Si catalogo corre en prod y en dev, ¿son dos trabajos o uno solo? Es uno solo con dos destinos.

**💻 Comando.** No hay comando. El alumno abre `infra/prometheus/prometheus.yml` en su editor.

| Clave | Qué es |
|---|---|
| `global` | Valores por defecto para todos los trabajos |
| `scrape_interval: 15s` | Cada cuánto se raspa cada destino |
| `scrape_timeout: 10s` | Cuánto se espera la respuesta antes de anotar `up` en 0 |
| `scrape_configs` | La lista de trabajos |
| `job_name: catalogo` | Nombre del trabajo. Termina como etiqueta `job` en cada serie |
| `static_configs` | Destinos escritos a mano, sin descubrimiento de servicios |
| `targets` | Lista de `host:puerto`. Termina como etiqueta `instance` |
| `labels` | Etiquetas fijas que se agregan a todas las series de ese destino |

**⚙️ Técnico.** `catalogo:8000` es un nombre de la red interna de Compose y el puerto interno del contenedor, no el puerto del anfitrión. La ruta `/metrics` y el esquema `http` son los valores por defecto. El archivo no nombra a pagos en ningún trabajo. Lo único que hay sobre pagos es el bloque `otlp`, que define cómo se traducen los nombres que llegan por push. La carpeta `infra/prometheus` completa está montada en `/etc/prometheus` dentro del contenedor, en solo lectura.

**📺 Salida.** No hay salida. El alumno debe poder señalar con el dedo `global`, `scrape_configs`, el trabajo catalogo con sus dos destinos y la etiqueta `ambiente` de cada uno.

**⚠️ Fallas.**

| Qué se ve | Causa | Arreglo |
|---|---|---|
| El alumno abre `infra/compose.yaml` | Confunde los archivos | La ruta es `infra/prometheus/prometheus.yml` |
| El editor muestra el archivo en una sola línea | Editor que no entiende fin de línea de Unix | Usar VS Code o Notepad++ |
| El alumno busca el trabajo pagos | Espera un trabajo por servicio | Recordar la Práctica 1. pagos llega por push OTLP |

---

## Paso 5. Agregar la etiqueta equipo con relabel_configs

**🎯 Problema.** Las series de catalogo no dicen a qué equipo pertenecen. Sin esa etiqueta no se puede enrutar una alerta al equipo correcto ni filtrar un dashboard por dueño, y pedirle a cada servicio que la publique obliga a tocar código.

**👵 Analogía.** El inspector le pega una etiqueta al reporte antes de archivarlo. El puesto no escribió esa etiqueta ni sabe que existe. La regla está en la hoja de ruta del inspector y vale para todos los puestos de ese pasillo.

**🔮 Predicción.** Preguntar antes de que guarden la versión con el error. La tercera línea tiene un espacio menos que la segunda. ¿Eso importa en YAML?

**💻 Comando.** El alumno edita el archivo y agrega primero la versión con el error que trae la guía.

```yaml
    relabel_configs:
      - target_label: equipo
       replacement: tienda
```

| Parte | Qué es |
|---|---|
| `relabel_configs` | Lista de reglas que se aplican a las etiquetas de cada destino antes del scrape |
| `- target_label: equipo` | Nombre de la etiqueta que la regla escribe |
| `replacement: tienda` | Valor que se escribe |
| `action` | No se escribe. Su valor por defecto es `replace` |
| `source_labels` y `regex` | No se escriben. Sin ellos la regla aplica siempre |

**⚙️ Técnico.** `relabel_configs` actúa sobre el destino antes de rasparlo, y las etiquetas que deja quedan en todas las series de ese destino. Es distinto de `metric_relabel_configs`, que actúa sobre cada serie después del scrape. En este caso el mismo resultado se lograría con `labels` dentro de `static_configs`, pero la práctica usa reetiquetado porque es lo que después permite reglas con condiciones. El error deliberado deja a `replacement` con siete espacios, uno menos que `target_label`, y YAML ya no sabe a qué pertenece esa clave.

**📺 Salida.** El archivo guardado con las tres líneas nuevas debajo de `ambiente: dev` del trabajo catalogo. Todavía no pasa nada en Prometheus.

**⚠️ Fallas.**

| Qué se ve | Causa | Arreglo |
|---|---|---|
| El alumno corrige la sangría por reflejo | Su editor da formato solo o vio el error | Pedirle que la deje mal. El Paso 6 necesita el error |
| El alumno pega el bloque en el trabajo pedidos | Se equivocó de trabajo | Moverlo debajo del `ambiente: dev` de catalogo |
| El alumno usa tabuladores | Editor configurado con tabuladores | YAML no los acepta. Cambiar a espacios |
| El alumno pega `relabel_configs` dentro de `static_configs` | Sangría de más en la primera línea | `relabel_configs` va alineado con `static_configs`, a cuatro espacios |

---

## Paso 6. Validar con promtool

**🎯 Problema.** Una configuración rota aplicada a ciegas puede dejar a Prometheus sin arrancar en el próximo reinicio. Sin una validación previa, el error se descubre en el peor momento.

**👵 Analogía.** `promtool` es el jefe que revisa la ruta nueva antes de mandar al inspector a la calle. Si la hoja está mal escrita la devuelve con una marca, y mientras tanto el inspector sigue caminando con la ruta vieja.

**🔮 Predicción.** Con la versión rota, preguntar antes del Enter. ¿En qué línea va a marcar el error? Con la versión corregida y ya validada, preguntar lo que pide la guía. ¿Prometheus ya tiene la etiqueta después de validar?

**💻 Comando.**

```bash
MSYS_NO_PATHCONV=1 docker exec gpe-prometheus promtool check config /etc/prometheus/prometheus.yml
```

| Parte | Qué es |
|---|---|
| `MSYS_NO_PATHCONV=1` | Variable solo para este comando. En Git Bash evita que la ruta que empieza con barra se convierta en una ruta de Windows. En macOS y Linux no hace nada |
| `docker exec` | Corre un programa dentro de un contenedor que ya está encendido |
| `gpe-prometheus` | El contenedor de Prometheus |
| `promtool` | Herramienta de línea de comandos que viene en la imagen oficial de Prometheus |
| `check config` | Subcomando que valida un archivo de configuración y los archivos de reglas que nombra |
| `/etc/prometheus/prometheus.yml` | Ruta del archivo dentro del contenedor. Es el mismo archivo que se edita en `infra/prometheus` |

**⚙️ Técnico.** `promtool` usa el mismo código de carga que el servidor, así que acepta y rechaza exactamente lo mismo. Valida sintaxis YAML, nombres de claves, expresiones regulares y reglas. No consulta al servidor que está corriendo. Sale con código 0 si el archivo es válido y con 1 si no. La consulta `count by (equipo) (up{job="catalogo"})` devuelve una serie sin etiqueta `equipo`, lo que prueba que validar no aplica nada.

**📺 Salida.** Con el error, estas dos líneas.

```text
Checking /etc/prometheus/prometheus.yml
  FAILED: parsing YAML file /etc/prometheus/prometheus.yml: yaml: line 99: did not find expected '-' indicator
```

La línea 99 es la de `target_label`, una antes de la que está mal. YAML avisa cerca del problema, no siempre encima. Con la corrección, esta salida.

```text
Checking /etc/prometheus/prometheus.yml
 SUCCESS: /etc/prometheus/prometheus.yml is valid prometheus config file syntax
```

**⚠️ Fallas.**

| Qué se ve | Causa | Arreglo |
|---|---|---|
| no such file or directory con una ruta que empieza con `C:/Program Files/Git` | Se omitió `MSYS_NO_PATHCONV=1` en Git Bash | Copiar el comando completo de la guía |
| El número de línea no es 95 | El bloque se pegó en otro lugar o con líneas en blanco de más | Va justo debajo de `ambiente: dev` de catalogo. Si el error es el mismo, seguir |
| SUCCESS con la versión que debía fallar | El editor corrigió la sangría | Quitar un espacio a `replacement` y guardar |
| Otro error, por ejemplo field relabel_config not found | Nombre de clave mal escrito | Es `relabel_configs`, en plural |
| Error response from daemon. Container is not running | Prometheus está detenido | `bin/up.sh` |

---

## Paso 7. Recargar con HUP y comprobar la etiqueta

**🎯 Problema.** Reiniciar Prometheus para aplicar un cambio deja un hueco en todas las métricas y obliga a releer el almacenamiento. En producción eso se nota en los dashboards y puede disparar alertas.

**👵 Analogía.** Al inspector le entregan la ruta nueva en la mano, sin que deje de trabajar. Termina la visita en la que está y sigue con la hoja nueva.

**🔮 Predicción.** Preguntar antes del Enter. Las muestras que ya están guardadas, ¿van a recibir la etiqueta `equipo`? No. La etiqueta aparece desde el primer scrape posterior a la recarga, y lo anterior queda como estaba.

**💻 Comando.**

```bash
docker exec gpe-prometheus kill -HUP 1
```

```promql
count by (equipo, ambiente) (http_server_requests_total{job="catalogo", equipo="tienda"})
```

| Parte | Qué es |
|---|---|
| `docker exec gpe-prometheus` | Corre lo que sigue dentro del contenedor de Prometheus |
| `kill` | Programa que envía una señal a un proceso. No lo mata salvo que la señal lo pida |
| `-HUP` | La señal SIGHUP. Prometheus la interpreta como la orden de releer su configuración |
| `1` | El identificador del proceso. Dentro del contenedor, Prometheus es el proceso 1 |
| `count by (equipo, ambiente)` | Cuenta series y conserva esas dos etiquetas |
| `http_server_requests_total` | Contador de peticiones HTTP de catalogo |

**⚙️ Técnico.** Al recibir SIGHUP, Prometheus vuelve a leer `prometheus.yml` y las reglas. Si el archivo es inválido conserva la configuración anterior y lo anota en su log. Al cambiar las etiquetas de un destino, sus series pasan a ser series nuevas. Las anteriores dejan de recibir muestras, pero una consulta instantánea las sigue encontrando durante 5 minutos, que es la ventana de búsqueda hacia atrás. Por eso la consulta de la guía filtra por `equipo="tienda"`. No usar `docker kill -s HUP gpe-prometheus`. Recarga igual, pero Docker deja de reiniciar ese contenedor solo hasta el siguiente `bin/up.sh`. La otra vía, una petición POST a `/-/reload`, necesita la opción `--web.enable-lifecycle`, que este stack no activa.

**📺 Salida.** El comando no imprime nada. Unos 30 segundos después, la consulta devuelve dos series, una con `ambiente="prod"` y otra con `ambiente="dev"`, las dos con `equipo="tienda"`. En **Status**, **Target health**, los dos destinos de catalogo muestran la etiqueta nueva.

**⚠️ Fallas.**

| Qué se ve | Causa | Arreglo |
|---|---|---|
| La consulta devuelve vacío | Todavía no hubo un scrape después de la recarga | Esperar 15 segundos y pulsar Execute |
| Sigue vacío después de un minuto | El archivo quedó inválido y Prometheus conservó lo anterior | `docker logs --tail 5 gpe-prometheus` y volver al Paso 6 |
| Solo aparece `ambiente="prod"` | catalogo-dev lleva poco arriba y todavía no recibió peticiones | Esperar 30 segundos |
| `sum(up)` da 13 o 14 en vez de 12 | Las series `up` anteriores a la recarga siguen dentro de los 5 minutos | Esperar. Se corrige solo |
| El alumno usó `docker restart gpe-prometheus` | Costumbre | Funciona, pero deja un hueco. Mostrar la diferencia en un gráfico de `up` |

---

## Paso 8. El datasource aprovisionado y uno manual de práctica

**🎯 Problema.** Si cada persona configura a mano la conexión entre Grafana y Prometheus, cada ambiente queda distinto y nadie sabe cuál es la buena. Y un dashboard que apunta a un datasource creado a mano deja de funcionar al reconstruir Grafana.

**👵 Analogía.** Grafana es la ventanilla de la oficina donde se consultan los reportes del inspector. La ventanilla no guarda nada, solo sabe en qué archivo buscar. Esa dirección viene escrita en el reglamento de la oficina, y por eso el funcionario de turno no puede cambiarla desde el mostrador.

**🔮 Predicción.** Preguntar antes de escribir la dirección del datasource manual. ¿Va `http://localhost:9090` o `http://prometheus:9090`? Va la segunda. Quien hace la consulta es el servidor de Grafana, desde dentro de la red de Compose.

**💻 Comando.** En Grafana, **Connections**, **Data sources**, **Prometheus**. Después **Add new data source**, **Prometheus**, esta dirección y **Save & test**.

```text
http://prometheus:9090
```

| Parte | Qué es |
|---|---|
| Provisioned data source | Aviso de Grafana. El datasource viene de un archivo y la interfaz no deja modificarlo |
| `http://prometheus:9090` | Nombre del servicio en la red de Compose y su puerto interno |
| **Save & test** | Guarda y hace una consulta de prueba a la API de Prometheus |
| **Delete** | Borra el datasource. Pide confirmación |

**⚙️ Técnico.** El archivo es `infra/grafana/provisioning/datasources/datasources.yaml`. Grafana lo lee al arrancar. Cada datasource lleva `editable: false` y un `uid` fijo, que es lo que los dashboards guardan como referencia. El de Prometheus es `prometheus`. El modo de acceso es proxy, es decir, el navegador le habla a Grafana y Grafana le habla a Prometheus. El datasource manual recibe el nombre `prometheus-1` y un uid al azar, y por eso no sirve para dashboards que se quieran compartir.

**📺 Salida.** En el datasource aprovisionado, un recuadro azul con el título Provisioned data source y todos los campos en gris. En el manual, un recuadro verde con el texto Successfully queried the Prometheus API. Después de borrar, la lista vuelve a mostrar cuatro datasources, Alertmanager, Loki, Prometheus y Tempo.

**⚠️ Fallas.**

| Qué se ve | Causa | Arreglo |
|---|---|---|
| Invalid username or password | La contraseña se cambió en una clase anterior | Leer `GRAFANA_ADMIN_PASSWORD` en `infra/.env`. Si no sirve, `bin/reset.sh` borra todo y la restablece |
| connection refused al probar | Se escribió `localhost` en la dirección | Cambiar a `http://prometheus:9090` |
| Please enter a valid URL | El campo quedó vacío. El texto gris es solo un ejemplo | Escribir la dirección completa |
| El alumno no borra el datasource | Olvido | La verificación lo marca en rojo. **Delete** en esa pantalla |
| El alumno intenta borrar el aprovisionado | Confusión | No tiene botón Delete. Es lo esperado |

---

## Paso 9. Dashboard Tianguis · Primer vistazo

**🎯 Problema.** Las consultas sueltas en la interfaz de Prometheus se pierden al cerrar la pestaña. Un equipo necesita una pantalla estable que responda siempre las mismas dos preguntas. ¿Está todo arriba? ¿Cuánto tráfico hay?

**👵 Analogía.** Es la pizarra de la oficina. De un lado, cuántos puestos contestaron en la última ronda. Del otro, cuánta clientela pasó por cada pasillo. La pizarra no mide nada, copia lo que dice la planilla del inspector cada vez que alguien la mira.

**🔮 Predicción.** Preguntar antes de ejecutar `sum(up)`. ¿Qué número va a salir? Son 12. Y antes de ver el gráfico de tráfico, preguntar cuántas líneas va a tener. Son dos, catalogo y pedidos. pagos no aparece.

**💻 Comando.** En Grafana, **Dashboards**, **New**, **New dashboard**. **Add tab** con título Salud, **Add panel**, **Configure visualization**, modo **Code**, la consulta y Shift con Enter. **All visualizations**, **Stat**. **Back**. **New tab** con título Tráfico y lo mismo con la segunda consulta y **Time series**. **Back**, **Save**.

```promql
sum(up)
```

```promql
sum by (job) (rate(http_server_requests_total[5m]))
```

| Parte | Qué es |
|---|---|
| `sum(up)` | Suma el `up` de todos los destinos. Como cada uno vale 1 o 0, da cuántos contestaron |
| `rate(http_server_requests_total[5m])` | Peticiones por segundo de cada serie, promediadas en 5 minutos |
| `sum by (job)` | Junta todas las rutas, métodos, códigos y ambientes, y deja una línea por trabajo |
| Stat | Visualización que muestra un solo número grande |
| Time series | Visualización de líneas en el tiempo |
| Tab | Pestaña del dashboard. Agrupa paneles y solo consulta los de la pestaña abierta |
| **Code** | Editor de texto para PromQL. **Builder** arma la consulta con menús |

**⚙️ Técnico.** Grafana 13 guarda los dashboards con pestañas en el esquema nuevo, versión 2. La API clásica los devuelve convertidos, con cada pestaña como una fila, y eso es lo que lee `verificar.sh`. El Stat pide una consulta de rango y muestra el último valor, por eso dibuja además una línea de fondo. pagos no aparece en el gráfico porque sus métricas HTTP vienen del agente de OpenTelemetry y se llaman distinto, `http_server_request_duration_seconds_count`. El punto medio del título se copia de la guía. Si el alumno escribe otro separador, la verificación igual lo encuentra porque busca el texto Primer vistazo.

**📺 Salida.** Un dashboard con dos pestañas. En Salud, un panel Destinos que responden con un 12 verde. En Tráfico, un panel Peticiones por segundo con dos líneas, catalogo cerca de 4 y pedidos cerca de 0.6. Al guardar aparece el aviso Dashboard saved.

**⚠️ Fallas.**

| Qué se ve | Causa | Arreglo |
|---|---|---|
| El panel dice No data | La consulta se escribió pero no se ejecutó | Hacer clic dentro de la consulta y pulsar Shift con Enter |
| No aparece el botón Add tab | El panel lateral de agregar está cerrado | Pulsar el botón con el signo más de la barra derecha |
| El Stat muestra 11 | Un destino está caído | Volver a Target health y encenderlo |
| El Stat muestra 13 o 14 | Pasaron menos de 5 minutos desde la recarga | Esperar y pulsar Refresh |
| El gráfico muestra muchas líneas | Faltó `sum by (job)` | Corregir la consulta |
| El alumno cierra la pestaña sin guardar | Olvido | Repetir. El dashboard no existe hasta pulsar Save |
| El alumno creó filas en vez de pestañas | Eligió Add row | Es válido. La verificación acepta filas o pestañas |

---

## Paso 10. Verificar y dejar todo en orden

**🎯 Problema.** Con cuarenta acciones en la guía es fácil saltarse una sin notarlo. Sin una revisión automática, el alumno se va creyendo que terminó.

**👵 Analogía.** Al cierre del día, el jefe repasa la planilla del inspector contra la hoja de ruta. Todos los puestos visitados, todas las etiquetas pegadas, la pizarra al día.

**🔮 Predicción.** Preguntar antes del Enter. ¿Cuál de las diez revisiones creen que puede salir en rojo? La que más falla es la del datasource de práctica sin borrar.

**💻 Comando.**

```bash
Capitulo2/verificar.sh
```

```bash
Capitulo2/restaurar.sh
```

| Parte | Qué es |
|---|---|
| `Capitulo2/verificar.sh` | Hace 10 revisiones contra Prometheus y Grafana. Sale con 0 si todas pasan y con 1 si falta alguna |
| `Capitulo2/restaurar.sh` | Devuelve `infra/prometheus/prometheus.yml` a su versión de git y recarga Prometheus. Solo se usa para repetir la práctica |

**⚙️ Técnico.** Las cuatro revisiones de Prometheus usan la API de destinos, `promtool` y dos consultas. Las seis de Grafana usan su API con el usuario y la contraseña de `infra/.env`. Si el dashboard no existe, las cuatro revisiones de sus paneles no se corren y el total baja a 6. `restaurar.sh` imprime en mayúsculas qué archivo va a sobrescribir, pide escribir SI y sin esa respuesta no toca nada. Usa `git checkout`, así que necesita que la carpeta sea un repositorio de git. No borra el dashboard.

**📺 Salida.** Diez líneas con OK en verde y PRÁCTICA LOGRADA 10 de 10 verificaciones en verde.

**⚠️ Fallas.**

| Qué se ve | Causa | Arreglo |
|---|---|---|
| Hay destinos caídos | catalogo-dev sigue detenido | `docker start gpe-catalogo-dev` |
| Los destinos de catalogo no llevan equipo | Se validó pero no se recargó | `docker exec gpe-prometheus kill -HUP 1` |
| Quedan datasources creados a mano | No se borró el de práctica | **Connections**, **Data sources**, abrirlo y **Delete** |
| No existe el dashboard | No se guardó o el título no contiene Primer vistazo | Guardarlo con el título de la guía |
| PARO gpe-grafana no está corriendo | El stack está abajo | `bin/up.sh` |

---

## ❓ Preguntas del alumno

Son preguntas de un alumno de nivel intermedio, que maneja la terminal y Docker básico pero no conoce Prometheus ni Grafana.

**¿Qué es un contenedor?**
Es un programa empaquetado con todo lo que necesita para correr, aislado del resto del equipo. En esta práctica cada servicio y cada herramienta del stack corre en su propio contenedor, y todos llevan el prefijo `gpe-`.

**¿Qué es un puerto?**
Es el número que identifica a un programa que escucha conexiones en una máquina. El stack publica Prometheus en el 9090 y Grafana en el 3000 del equipo del alumno, y solo en 127.0.0.1.

**¿Qué es una etiqueta?**
Es un par de nombre y valor que acompaña a cada serie, como `job="catalogo"` o `ambiente="dev"`. La misma métrica con etiquetas distintas da series distintas, y por eso cambiar una etiqueta crea series nuevas.

**¿Por qué no veo datos apenas ejecuto una consulta?**
Prometheus solo tiene lo que anotó en sus visitas, que en esta práctica ocurren cada 15 segundos. Después de encender un contenedor o recargar hay que esperar al menos un scrape. Una consulta con `rate` sobre 5 minutos necesita además que el stack lleve un rato arriba.

**¿Por qué en el navegador va `localhost:9090` y en Grafana `prometheus:9090`?**
`localhost` es el equipo del alumno, donde el stack publica el puerto 9090. La consulta del datasource la hace el servidor de Grafana desde dentro de la red de Compose, donde Prometheus se encuentra por el nombre de su servicio.

**¿Por qué no usar `labels` en `static_configs` en vez de `relabel_configs`?**
Para una etiqueta fija el resultado es el mismo y `labels` es más simple. El reetiquetado se justifica cuando hay condiciones, cuando el valor sale de otra etiqueta o cuando los destinos vienen de descubrimiento de servicios y no hay dónde escribir `labels`.

**¿Qué diferencia hay entre `relabel_configs` y `metric_relabel_configs`?**
La primera actúa sobre el destino antes del scrape y puede decidir incluso no rasparlo. La segunda actúa sobre cada serie ya raspada y sirve para descartar o renombrar métricas. La segunda cuesta más porque corre por cada muestra.

**¿Por qué `sum(up)` puede dar 13 justo después de recargar?**
Porque al cambiar las etiquetas de un destino sus series son nuevas, y las anteriores siguen respondiendo consultas instantáneas durante los 5 minutos de la ventana de búsqueda hacia atrás.

**¿Se puede recargar por HTTP en vez de usar la señal?**
Sí, con una petición POST a `/-/reload`, pero hay que arrancar Prometheus con `--web.enable-lifecycle`. Este stack no lo activa porque esa ruta no pide credenciales.

**¿Qué pasa si recargo con el archivo roto?**
Prometheus rechaza la recarga, conserva la configuración que tenía y escribe el error en su log. El riesgo aparece en el siguiente reinicio, que sí falla. Por eso `promtool` va antes.

**¿Por qué `promtool` corre dentro del contenedor y no en mi máquina?**
Para usar exactamente la misma versión que el servidor y no instalar nada. La carpeta de configuración está montada dentro del contenedor, así que ve el mismo archivo que se edita afuera.

**¿15 segundos de intervalo no es demasiado frecuente?**
Es un valor común para aprender porque los cambios se ven rápido. En producción son habituales 30 o 60 segundos. Bajar el intervalo aumenta las muestras guardadas en la misma proporción.

**¿Por qué pagos no aparece en el gráfico de tráfico?**
Porque sus métricas HTTP las genera el agente de OpenTelemetry con otra convención de nombres. Se retoma en la Práctica 4, al armar el dashboard con el método RED.

**¿Dónde queda guardado el dashboard?**
En la base de datos interna de Grafana, dentro del volumen `gpe_grafana-datos`. Sobrevive a `bin/down.sh` y se pierde con `bin/reset.sh`. Guardarlo como código se ve en el Capítulo 9.
