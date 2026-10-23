// Práctica 7. Arma Capitulo7/README.md con los bloques de 7-etapas.mjs, para que la guía muestre
// exactamente lo que escriben los pasos de captura.
//
//   node tools/capturas/pasos/7-guia.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bloque, prometheusYml, datasources, compose, CLAVES } from './7-etapas.mjs';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const T = 'Capitulo7/trabajo';
const CA = `${T}/certs/ca.crt`;
const CAPA = 'docker compose -p gpe --env-file infra/.env -f infra/compose.yaml -f Capitulo7/compose.seguridad.yaml up -d';
const img = (n, alt) => `![${alt}](../images/7/${n}.png)`;
// La configuración de Dex como queda en el paso 43, con los hashes todavía por poner.
const dexConfig = () => readFileSync(join(RAIZ, 'Capitulo7', 'dex', 'config.yaml'), 'utf8')
  .replace('secret: SECRETO_OAUTH', `secret: ${CLAVES.oauth}`)
  .replace('https://localhost:PUERTO_GRAFANA/', 'https://localhost:3000/');
const cod = (lenguaje, texto) => '```' + lenguaje + '\n' + texto.replace(/\n+$/, '') + '\n```';

// Trozo de un archivo entre dos líneas, para mostrar solo lo que cambia.
function trozo(texto, desde, hasta) {
  const lineas = texto.split('\n');
  const i = lineas.findIndex((l) => l.startsWith(desde));
  const j = lineas.findIndex((l, k) => k > i && l.startsWith(hasta));
  return lineas.slice(i, j).join('\n');
}
const jobBloque = (texto, nombre) => {
  const lineas = texto.split('\n');
  const i = lineas.findIndex((l) => l === `  - job_name: ${nombre}`);
  let j = i + 1;
  while (j < lineas.length && !lineas[j].startsWith('  - job_name:') && lineas[j].trim() !== '') j += 1;
  return lineas.slice(i, j).join('\n');
};
const datasource = (texto, nombre) => {
  const lineas = texto.split('\n');
  const i = lineas.findIndex((l) => l === `  - name: ${nombre}`);
  let j = i + 1;
  while (j < lineas.length && !lineas[j].startsWith('  - name:')) j += 1;
  return lineas.slice(i, j).join('\n').replace(/\n+$/, '');
};

const aplicar = (n) => `${n}. Aplicar la capa. Compose recrea solo los contenedores que cambiaron.

${cod('bash', CAPA)}`;

const guia = `# Práctica 7. Red segura y certificados TLS para Prometheus y Grafana

En esta práctica se protege el stack de observabilidad. Se mide qué queda expuesto, se crea una CA propia con sus certificados y se ponen TLS y autenticación básica en node_exporter, Prometheus y Alertmanager. Después Grafana pasa a HTTPS, se conecta con Dex para entrar con OAuth y se reparten permisos con roles, equipos y una cuenta de servicio. Al final las claves salen del texto plano y quedan en archivos.

## Objetivos
- Medir la superficie de exposición del stack.
- Crear una CA propia y certificados con openssl.
- Configurar TLS y autenticación básica en node_exporter, Prometheus y Alertmanager con su web config.
- Raspar y enviar alertas por TLS con credenciales.
- Servir Grafana por HTTPS y entrar con OAuth contra Dex.
- Separar permisos con roles, equipos, carpetas y una cuenta de servicio con token.
- Sacar las claves de los archivos de configuración y leerlas desde archivos montados.

## El problema y la solución

Un mercado guarda en su bodega lo que vende y en su oficina el registro de cada caja.
Si sus puertas quedan abiertas a la calle, cualquiera entra, mira los libros y se va sin que nadie lo note.
Un stack de observabilidad está en la misma situación, porque ve todo lo que pasa en los servicios de la empresa.

La práctica comienza por recorrer el perímetro y contar las puertas abiertas.
Después una CA propia hace de municipalidad y emite una credencial con foto para cada guardia, que es el certificado de cada componente.
Con esas credenciales la información viaja como en un camión blindado, que es TLS, y en cada puerta un guardia pide nombre y clave.

Grafana recibe a las personas con una credencial municipal que emite Dex y sirve para entrar sin tener una clave distinta en cada edificio.
Dentro, cada uno mira o escribe en el pizarrón según su rol, y el camión repartidor recibe una llave propia que se puede anular.
Al final las claves pasan de la pizarra a la caja fuerte, es decir, de los archivos de configuración a archivos aparte.

En el NOC esto aparece como un destino caído con un error \`x509\` o \`401\` después de un cambio de certificados o de claves, o como un usuario que no ve una carpeta de dashboards que necesita.
Con esta práctica se aprende a leer esos errores y a saber qué puerta, qué certificado o qué permiso revisar antes de escalar.

## Duración aproximada
- 150 minutos.

---
<div style="width: 400px;">
        <table width="50%">
            <tr>
                <td style="text-align: center;">
                    <a href="../Capitulo6/"><img src="../images/anterior.png" width="40px"></a>
                    <br>anterior
                </td>
                <td style="text-align: center;">
                   <a href="../README.md">Lista Laboratorios</a>
                </td>
<td style="text-align: center;">
                    <a href="../Capitulo8/">
                    <img src="../images/siguiente.png"
                     width="40px"></a>
                    <br>siguiente
                </td>
            </tr>
        </table>
</div>

---

## Diagrama

![diagrama](../images/7/diagrama.png)

<br>

## Instrucciones

>**Nota.** Todo lo que se crea en esta práctica vive en \`Capitulo7/trabajo\` y en \`Capitulo7/compose.seguridad.yaml\`. La configuración de \`infra\` no se toca. Al terminar, \`Capitulo7/restaurar.sh\` deja el stack como estaba.

### Preparar el punto de partida

Antes de poner guardias hay que conocer el estado del mercado.
El script deja el stack base en un estado conocido y revisa que openssl esté disponible, porque con él se fabrican las credenciales.

1. Abrir una terminal en la carpeta del repositorio. En Windows usar Git Bash.

2. Dejar el stack base en el punto de partida. El script también confirma que openssl está disponible.

${cod('bash', 'Capitulo7/preparar.sh')}

${img(1, 'punto de partida')}

### Superficie de exposición

Antes de cerrar puertas hay que contarlas.
Este bloque recorre el perímetro del stack y revisa qué responde cada puerto a quien llega sin presentarse.
Lo que se anote aquí sirve para comparar al final de la práctica.

3. Listar los contenedores del proyecto y los puertos que publican en la máquina.

${cod('bash', "docker ps --filter label=com.docker.compose.project=gpe --format 'table {{.Names}}\\t{{.Ports}}'")}

${img(2, 'puertos publicados')}

4. Antes de abrir las siguientes direcciones, anotar una predicción. ¿Qué podría ver alguien de la red con solo abrirlas?

5. Abrir \`http://localhost:9090/config\`. Prometheus muestra su configuración completa sin pedir nada.

${img(3, 'configuración de Prometheus')}

6. Abrir \`http://localhost:9090/targets\`. Aparecen todos los destinos con sus direcciones internas.

${img(4, 'destinos de Prometheus')}

7. Pedir las métricas de node_exporter.

${cod('bash', "curl -s http://localhost:9100/metrics | grep -m 8 '^node_uname_info\\|^node_os_info\\|^node_filesystem_size_bytes'")}

${img(5, 'métricas de node_exporter')}

>**Nota.** El nombre de la máquina, el kernel y los discos están a la vista. Todos los puertos escuchan solo en 127.0.0.1, pero en un servidor real cualquiera de la red llegaría igual.

### CA propia y certificados

Un guardia sin credencial no puede demostrar quién es.
Aquí se crea la municipalidad del curso, que es la CA, y con ella se emite una credencial con foto para cada componente.
Quien conozca el sello de la CA puede revisar cualquiera de esas credenciales.

8. Crear la carpeta de los certificados y una CA propia, válida por un año.

${cod('bash', `mkdir -p ${T}/certs
MSYS_NO_PATHCONV=1 openssl req -x509 -newkey rsa:2048 -nodes -days 365 -keyout ${T}/certs/ca.key -out ${T}/certs/ca.crt -subj "/CN=CA del Tianguis"
openssl x509 -in ${T}/certs/ca.crt -noout -subject -issuer -dates`)}

${img(6, 'CA propia')}

>**Nota.** \`MSYS_NO_PATHCONV=1\` es para Git Bash, que si no convierte \`/CN=...\` en una ruta de Windows. En macOS no hace nada.

9. Crear una clave y un certificado firmado por la CA para cada componente. El certificado vale para el nombre interno de Docker, para \`localhost\` y para \`127.0.0.1\`.

${cod('bash', `for s in prometheus node-exporter alertmanager grafana; do
  MSYS_NO_PATHCONV=1 openssl req -newkey rsa:2048 -nodes -keyout ${T}/certs/$s.key -out ${T}/certs/$s.csr -subj "/CN=$s"
  printf 'subjectAltName=DNS:%s,DNS:localhost,IP:127.0.0.1\\n' $s > ${T}/certs/$s.ext
  openssl x509 -req -in ${T}/certs/$s.csr -CA ${T}/certs/ca.crt -CAkey ${T}/certs/ca.key -CAcreateserial -days 365 -extfile ${T}/certs/$s.ext -out ${T}/certs/$s.crt
done
chmod 644 ${T}/certs/*.key
ls ${T}/certs`)}

${img(7, 'certificados')}

>**Nota.** \`chmod 644\` deja que los contenedores lean las claves, porque corren con otro usuario. En un servidor real las claves se protegen con su dueño y un permiso 600.

10. Comprobar que el certificado de Prometheus está firmado por la CA y ver sus nombres.

${cod('bash', `openssl verify -CAfile ${T}/certs/ca.crt ${T}/certs/prometheus.crt
openssl x509 -in ${T}/certs/prometheus.crt -noout -text | grep -A1 'Subject Alternative Name'`)}

${img(8, 'verificación del certificado')}

### node_exporter con TLS y autenticación

node_exporter es la primera puerta que recibe guardia.
El guardia muestra su credencial a quien llega y pide nombre y clave antes de dejar pasar.
Prometheus es quien más entra por esa puerta, así que también tiene que aprender a presentarse.

11. Calcular el hash bcrypt de la clave con la que Prometheus va a raspar a node_exporter. \`htpasswd\` corre dentro de un contenedor, así no hace falta instalar nada.

${cod('bash', 'docker run --rm httpd:2.4.68-alpine htpasswd -nbBC 10 prometheus raspar-2026')}

${img(9, 'hash bcrypt')}

12. Crear el archivo \`${T}/node-exporter/web.yml\` con este contenido. Reemplazar \`HASH\` por lo que aparece después de \`prometheus:\` en la salida del paso anterior.

${cod('yaml', `# node_exporter con TLS y autenticación básica.
tls_server_config:
  cert_file: /etc/tls/node-exporter.crt
  key_file: /etc/tls/node-exporter.key
basic_auth_users:
  prometheus: HASH`)}

| Línea | Qué hace |
|---|---|
| \`# node_exporter con TLS...\` | Comentario. node_exporter lo ignora |
| \`tls_server_config\` | Activa TLS en node_exporter |
| \`cert_file\` | Certificado que node_exporter presenta, el que firmó la CA en el paso 9 |
| \`key_file\` | Clave privada de ese certificado |
| \`basic_auth_users\` | Usuarios que pueden entrar |
| \`prometheus: HASH\` | El usuario \`prometheus\` con el hash bcrypt de su clave, nunca la clave en texto |

>**Nota.** No hace falta saber programar para este paso. Se copia el bloque en un archivo nuevo y se cambia solo la palabra \`HASH\`. Si la carpeta \`node-exporter\` no existe, el editor la crea al guardar. Las rutas \`/etc/tls/...\` son las de dentro del contenedor, donde el compose del paso 15 monta la carpeta \`certs\`. El formato de este archivo es el mismo en node_exporter, Prometheus y Alertmanager y está en la documentación de Prometheus, https://prometheus.io/docs/prometheus/latest/configuration/https/

13. Copiar la configuración de Prometheus a la carpeta de trabajo.

${cod('bash', `mkdir -p ${T}/prometheus
cp infra/prometheus/prometheus.yml ${T}/prometheus/prometheus.yml`)}

14. En \`${T}/prometheus/prometheus.yml\` reemplazar el job \`node_exporter\` por este. Todavía sin la CA.

${cod('yaml', jobBloque(prometheusYml('sin-ca'), 'node_exporter'))}

| Línea | Qué hace |
|---|---|
| \`job_name\` | Nombre del job, el mismo que ya tenía |
| \`scheme: https\` | Prometheus raspa por TLS y no por http |
| \`tls_config\` | Cómo revisa Prometheus el certificado de node_exporter. El comentario de adentro se cambia en el paso 18 |
| \`basic_auth\` | Usuario y clave con que Prometheus se presenta |
| \`username\` y \`password\` | El usuario y la clave cuyo hash quedó en \`web.yml\` |
| \`static_configs\` y \`targets\` | La dirección de node_exporter en la red de Docker, sin cambios |

>**Nota.** No hace falta saber programar. Se borra el job \`node_exporter\` que trae el archivo, desde su línea \`- job_name\` hasta antes del siguiente \`- job_name\`, y se pega este en su lugar con la misma sangría. Los campos de un job están en la documentación de Prometheus, https://prometheus.io/docs/prometheus/latest/configuration/configuration/

15. Reemplazar todo el contenido de \`Capitulo7/compose.seguridad.yaml\` por este.

${cod('yaml', compose(3))}

${aplicar(16)}

${img(10, 'capa aplicada')}

17. Esperar unos 30 segundos y abrir \`http://localhost:9090/targets\`. Antes de mirar, anotar qué va a pasar con node_exporter si Prometheus todavía no tiene la CA. Para razonarlo, repasar en la introducción de CA propia y certificados quién puede revisar una credencial.

${img(11, 'node_exporter sin la CA')}

>**Nota.** El destino queda abajo con un error x509. Prometheus llega por TLS, pero no reconoce a quien firmó el certificado y corta la conexión.

18. En el job \`node_exporter\` reemplazar la línea del comentario por \`ca_file: /etc/tls/ca.crt\`, dentro de \`tls_config\`. El job queda así.

${cod('yaml', jobBloque(prometheusYml(3), 'node_exporter'))}

\`ca_file\` es el certificado de la CA, montado en el contenedor de Prometheus. Con él Prometheus revisa la credencial que presenta node_exporter. Guardar y recargar Prometheus.

${cod('bash', 'docker exec gpe-prometheus kill -HUP 1')}

19. Recargar la página de destinos. node_exporter queda UP por https.

${img(12, 'node_exporter por TLS')}

20. Probar node_exporter sin clave y con clave.

>**Nota.** En Git Bash de Windows, antes de este paso correr \`alias curl='curl --ssl-no-revoke'\` en la terminal. El curl de Git Bash revisa si el certificado fue revocado, y la CA del curso no publica esa lista, así que sin el alias responde \`the revocation status is unknown\`. En macOS y Linux no hace falta.

${cod('bash', `curl -s -o /dev/null -w '%{http_code}\\n' --cacert ${CA} https://localhost:9100/metrics
curl -s -o /dev/null -w '%{http_code}\\n' --cacert ${CA} -u prometheus:raspar-2026 https://localhost:9100/metrics`)}

${img(13, '401 y 200')}

### Prometheus con TLS y autenticación

Prometheus es la puerta principal del mercado, con su interfaz y su API.
Ahora el guardia se pone también ahí, y cada visita muestra su credencial, incluido el propio Prometheus cuando se revisa a sí mismo.
Grafana es una de esas visitas, por eso su datasource también cambia.

21. Calcular el hash de la clave para entrar a Prometheus y a Alertmanager.

${cod('bash', 'docker run --rm httpd:2.4.68-alpine htpasswd -nbBC 10 tianguis mirar-2026')}

${img(14, 'hash de tianguis')}

22. Crear \`${T}/prometheus/web.yml\` con este contenido, con el hash de tianguis. Las líneas son las mismas del paso 12, con el certificado de Prometheus y el usuario \`tianguis\`.

${cod('yaml', `# La interfaz y la API de Prometheus, con TLS y autenticación básica.
tls_server_config:
  cert_file: /etc/tls/prometheus.crt
  key_file: /etc/tls/prometheus.key
basic_auth_users:
  tianguis: HASH`)}

23. En \`${T}/prometheus/prometheus.yml\` reemplazar el job \`prometheus\` por este. Prometheus se raspa a sí mismo y ahora también tiene que presentarse.

${cod('yaml', jobBloque(prometheusYml(4), 'prometheus'))}

24. Copiar los datasources de Grafana a la carpeta de trabajo.

${cod('bash', `mkdir -p ${T}/grafana/datasources
cp infra/grafana/provisioning/datasources/datasources.yaml ${T}/grafana/datasources/datasources.yaml`)}

25. En \`${T}/grafana/datasources/datasources.yaml\` reemplazar el datasource Prometheus por este.

${cod('yaml', datasource(datasources(4), 'Prometheus'))}

26. En \`compose.seguridad.yaml\` reemplazar el bloque \`prometheus\` por el siguiente y agregar al final el bloque \`grafana\`.

${cod('yaml', bloque('prometheus', 4) + '\n' + bloque('grafana', 4))}

${aplicar(27)}

28. Probar la API de Prometheus sin clave y con clave.

${cod('bash', `curl -s -o /dev/null -w '%{http_code}\\n' --cacert ${CA} https://localhost:9090/api/v1/status/config
curl -s -o /dev/null -w '%{http_code}\\n' --cacert ${CA} -u tianguis:mirar-2026 https://localhost:9090/api/v1/status/config`)}

${img(15, 'Prometheus pide clave')}

29. Abrir \`https://localhost:9090/targets\`. El navegador avisa que no conoce la CA. Aceptar el riesgo para continuar y entrar con el usuario \`tianguis\` y la clave \`mirar-2026\`.

${img(16, 'destinos por https')}

>**Nota.** El aviso aparece porque la CA es nuestra y el navegador no la conoce. En una empresa la CA interna se instala en los equipos y el aviso desaparece.

30. En Grafana abrir **Explore** y ejecutar \`up{job=~"prometheus|node_exporter"}\`. Grafana llega a Prometheus por TLS y con clave.

${img(17, 'Grafana consulta por TLS')}

### Alertmanager con TLS y autenticación

Alertmanager es la sala de la central de avisos del mercado.
Quien entra ahí maneja los avisos de todos los servicios, así que recibe el mismo guardia que Prometheus.
Prometheus le lleva las alertas en el camión blindado y mostrando su credencial.

31. Crear \`${T}/alertmanager/web.yml\` con el mismo hash de tianguis. Las líneas son las mismas del paso 12, con el certificado de Alertmanager.

${cod('yaml', `# La interfaz y la API de Alertmanager, con TLS y autenticación básica.
tls_server_config:
  cert_file: /etc/tls/alertmanager.crt
  key_file: /etc/tls/alertmanager.key
basic_auth_users:
  tianguis: HASH`)}

32. En \`${T}/prometheus/prometheus.yml\` reemplazar la sección \`alerting\` y el job \`alertmanager\` por estos.

${cod('yaml', trozo(prometheusYml(5), 'alerting:', 'scrape_configs:').replace(/\n+$/, '') + '\n\n' + jobBloque(prometheusYml(5), 'alertmanager'))}

33. En \`${T}/grafana/datasources/datasources.yaml\` reemplazar el datasource Alertmanager por este.

${cod('yaml', datasource(datasources(5), 'Alertmanager'))}

34. En \`compose.seguridad.yaml\` agregar este bloque antes de \`grafana\`.

${cod('yaml', bloque('alertmanager', 5))}

${aplicar(35)}

36. Recargar Prometheus, que leyó \`prometheus.yml\` nuevo, y comprobar que Alertmanager pide clave y que Prometheus le envía las alertas por https.

${cod('bash', `docker exec gpe-prometheus kill -HUP 1
curl -s -o /dev/null -w '%{http_code}\\n' --cacert ${CA} https://localhost:9093/api/v2/status
curl -s --cacert ${CA} -u tianguis:mirar-2026 https://localhost:9090/api/v1/alertmanagers`)}

${img(18, 'Alertmanager por TLS')}

### Grafana en HTTPS

Grafana es la puerta que usan las personas y guarda sus sesiones.
Sin HTTPS esa información viaja por la calle a la vista de cualquiera.
Aquí Grafana recibe su propia credencial de la CA y comienza a usar el camión blindado.

37. En \`compose.seguridad.yaml\` reemplazar el bloque \`grafana\` por este.

${cod('yaml', bloque('grafana', 6))}

${aplicar(38)}

39. Ver el certificado que presenta Grafana y comprobar que lo firmó la CA del curso.

${cod('bash', `openssl s_client -connect localhost:3000 -servername localhost -CAfile ${CA} </dev/null 2>/dev/null | grep -E 'subject=|issuer=|Verify return code'`)}

${img(19, 'certificado de Grafana')}

40. Consultar la salud de Grafana por https.

${cod('bash', `curl -s --cacert ${CA} https://localhost:3000/api/health`)}

${img(20, 'Grafana por https')}

41. Abrir \`https://localhost:3000\`, aceptar el aviso del navegador y pulsar el candado o el aviso de la barra de direcciones. El certificado dice que lo emitió **CA del Tianguis** y que vale para \`grafana\`, \`localhost\` y \`127.0.0.1\`.

### Login con Dex

Una clave distinta en cada herramienta termina escrita en un papel.
Dex es la oficina municipal que emite una sola credencial para entrar a todos los edificios.
Para esos usuarios Grafana no guarda clave y solo le pregunta a Dex quién es la persona.

42. Calcular los hashes de las claves de Ana y Beto, dos usuarios de Dex.

${cod('bash', `docker run --rm httpd:2.4.68-alpine htpasswd -nbBC 10 ana ana-2026
docker run --rm httpd:2.4.68-alpine htpasswd -nbBC 10 beto beto-2026`)}

${img(21, 'hash de Ana')}

43. Crear \`${T}/dex/config.yaml\` copiando \`Capitulo7/dex/config.yaml\`. Reemplazar \`HASH_ANA\` y \`HASH_BETO\` por los hashes, \`SECRETO_OAUTH\` por \`secreto-de-grafana-2026\` y \`PUERTO_GRAFANA\` por el puerto de Grafana de \`infra/.env\`, que es 3000 si no se cambió.

${cod('bash', `mkdir -p ${T}/dex
cp Capitulo7/dex/config.yaml ${T}/dex/config.yaml`)}

Con el secreto y el puerto ya puestos, el archivo queda así. Falta cambiar \`HASH_ANA\` y \`HASH_BETO\` por lo que aparece después de \`ana:\` y de \`beto:\` en la salida del paso 42. Si en \`infra/.env\` el puerto de Grafana no es 3000, cambiarlo también en \`redirectURIs\`.

${cod('yaml', dexConfig())}

| Línea | Qué hace |
|---|---|
| \`issuer\` | Dirección con que el navegador llega a Dex |
| \`storage\` | Dex guarda las sesiones en memoria |
| \`web\` y \`telemetry\` | Puertos donde Dex atiende el login y su chequeo de salud |
| \`skipApprovalScreen\` | No pide aprobar permisos en cada entrada |
| \`staticClients\` | Las aplicaciones que pueden usar Dex. Aquí solo Grafana |
| \`id\` y \`secret\` | Nombre y clave con que Grafana se presenta ante Dex. Son los mismos del compose del paso 44 |
| \`redirectURIs\` | Dirección de Grafana a la que Dex devuelve a la persona después del login |
| \`enablePasswordDB\` | Activa los usuarios con clave escritos en este archivo |
| \`staticPasswords\` | Los usuarios Ana y Beto, con su email, su nombre, un identificador fijo y el hash bcrypt de su clave |

>**Nota.** No hace falta saber programar. Basta abrir el archivo copiado y cambiar las cuatro palabras en mayúsculas. Los usuarios con clave de Dex están en https://dexidp.io/docs/connectors/local/ y las variables de Grafana del paso 44 en https://grafana.com/docs/grafana/latest/setup-grafana/configure-access/configure-authentication/generic-oauth/

44. En \`compose.seguridad.yaml\` reemplazar el bloque \`grafana\` por el siguiente y agregar al final el bloque \`dex\`.

${cod('yaml', bloque('grafana', 7) + '\n' + bloque('dex', 7))}

${aplicar(45)}

46. Cerrar la sesión de Grafana y abrir \`https://localhost:3000/login\`. Aparece el botón **Sign in with Dex**.

${img(22, 'login con Dex')}

47. Pulsar **Sign in with Dex**. En la página de Dex entrar con \`beto@tianguis.local\` y la clave \`beto-2026\`.

${img(23, 'login de Dex')}

48. Grafana crea el usuario la primera vez que entra. Abrir el perfil, arriba a la derecha, y bajar hasta **Organizations**. Beto entró como **Viewer**.

${img(24, 'beto como Viewer')}

>**Nota.** La regla \`GF_AUTH_GENERIC_OAUTH_ROLE_ATTRIBUTE_PATH\` le da Editor solo a \`ana@tianguis.local\`. Cualquier otro usuario de Dex entra como Viewer.

49. Cerrar la sesión y entrar con \`admin\`. En **Administration**, **Users and access**, **Users**, Beto aparece con el origen **Generic OAuth**.

${img(25, 'usuario creado por OAuth')}

### Roles, equipo y carpeta restringida

Una vez dentro, no todos tienen que hacer lo mismo.
Algunos solo miran el pizarrón y otros pueden escribir en él.
Además se arma una vitrina con llave para el equipo de pagos.

50. En **Users** pulsar **New user**. Crear a Vera con el login \`vera\`, el email \`vera@tianguis.local\` y la clave \`vera-2026\`. Pulsar **Create user**.

${img(26, 'usuario Vera')}

51. Crear de la misma forma a Edu, con el login \`edu\`, el email \`edu@tianguis.local\` y la clave \`edu-2026\`.

52. Abrir la pestaña **Organization users** y en la fila de Edu cambiar **Role** a **Editor**. Vera queda como **Viewer**.

${img(27, 'roles de la organización')}

53. Abrir **Teams**, pulsar **New team**, escribir \`equipo-pagos\` y pulsar **Create**. Entrar al equipo, pulsar **Add member**, elegir **User**, elegir a \`edu\` y pulsar **Save**.

${img(28, 'equipo con Edu')}

54. Abrir **Dashboards**, pulsar **New** y elegir **New folder**. Llamarla \`Pagos restringido\` y pulsar **Create**. En **Folder actions** elegir **Manage permissions**. Quitar los permisos de los roles **Editor** y **Viewer** con el ícono de la papelera y pulsar **Add a permission**.

${img(29, 'permisos de la carpeta')}

55. En **Add permission for** elegir **Team**, después \`equipo-pagos\`, el permiso **Edit**, y pulsar **Save**.

${img(30, 'permiso para el equipo')}

56. Abrir **Dashboards**, **New**, **Import dashboard**. Subir el archivo \`Capitulo4/sin-internet/host-use.json\`, elegir la carpeta \`Pagos restringido\` y pulsar **Import**.

${img(31, 'importar en la carpeta')}

57. Cerrar la sesión y entrar como \`vera\`. En **Dashboards** la carpeta \`Pagos restringido\` no aparece.

${img(32, 'lo que ve Vera')}

58. Cerrar la sesión y entrar como \`edu\`. La carpeta aparece con el dashboard Host · USE, que Edu puede editar por el equipo.

${img(33, 'lo que ve Edu')}

### Cuenta de servicio y token

Los scripts también llaman a Grafana y no deberían usar la clave de una persona.
La cuenta de servicio es el camión repartidor, con su propia llave y su propio registro.
Esa llave se puede anular sin tocar las de nadie más.

59. Cerrar la sesión y entrar con \`admin\`. En **Users and access** abrir **Service accounts** y pulsar **Add service account**. Llamarla \`repartidor\`, dejar el rol **Viewer** y pulsar **Create**. Pulsar **Add service account token** y después **Generate token**.

${img(34, 'token de la cuenta de servicio')}

60. Copiar el token, que empieza con \`glsa_\`, y pegarlo en un archivo nuevo \`${T}/token-repartidor\`. Grafana no lo vuelve a mostrar. Después pulsar **Close**.

61. Consultar la API de Grafana con el token.

${cod('bash', `curl -s --cacert ${CA} -H "Authorization: Bearer $(cat ${T}/token-repartidor)" "https://localhost:3000/api/search?query=Tianguis"`)}

${img(35, 'API con el token')}

>**Nota.** La respuesta no trae la carpeta \`Pagos restringido\`. El token tiene el rol Viewer de la cuenta de servicio y la carpeta solo es para el equipo.

62. En la fila del token pulsar el ícono de la papelera y confirmar con **Delete**.

${img(36, 'token revocado')}

63. Repetir la consulta. Ahora la respuesta es 401.

${cod('bash', `curl -s -o /dev/null -w '%{http_code}\\n' --cacert ${CA} -H "Authorization: Bearer $(cat ${T}/token-repartidor)" "https://localhost:3000/api/search?query=Tianguis"`)}

${img(37, 'token rechazado')}

### Secretos en archivos

Hasta aquí las claves quedaron escritas en la pizarra, a la vista de quien lea la configuración.
Esos archivos se copian, se suben a git y se pegan en chats.
Ahora cada clave pasa a la caja fuerte, y la configuración solo dice dónde está.

64. Hasta aquí las claves quedaron escritas en \`prometheus.yml\`, en los datasources y en el compose. Crear un archivo por clave en \`${T}/secretos\`.

${cod('bash', `mkdir -p ${T}/secretos
printf '%s' 'raspar-2026' > ${T}/secretos/raspar
printf '%s' 'mirar-2026' > ${T}/secretos/mirar
printf '%s' 'secreto-de-grafana-2026' > ${T}/secretos/oauth_grafana
grep '^GRAFANA_ADMIN_PASSWORD=' infra/.env | cut -d= -f2- | tr -d '\\r\\n' > ${T}/secretos/grafana_admin
chmod 644 ${T}/secretos/*
ls -l ${T}/secretos`)}

${img(38, 'archivos de secretos')}

65. En \`${T}/prometheus/prometheus.yml\` cambiar cada línea \`password: ...\` por \`password_file\` con el archivo que corresponde. Así queda el job \`node_exporter\`.

${cod('yaml', jobBloque(prometheusYml(10), 'node_exporter'))}

>**Nota.** Los jobs \`prometheus\` y \`alertmanager\` y la sección \`alerting\` usan \`password_file: /run/secretos/mirar\`.

Para no editar línea por línea, se puede reemplazar todo el contenido de \`${T}/prometheus/prometheus.yml\` por este, que ya trae los cuatro cambios.

${cod('yaml', prometheusYml(10))}

| Línea | Qué hace |
|---|---|
| \`password_file: /run/secretos/raspar\` | Prometheus lee la clave de node_exporter del archivo \`raspar\` en cada raspado |
| \`password_file: /run/secretos/mirar\` | Lo mismo para Prometheus y Alertmanager, con el archivo \`mirar\` |
| \`/run/secretos\` | Ruta dentro del contenedor, donde el compose del paso 67 monta la carpeta \`secretos\` |

>**Nota.** No hace falta saber programar. El resto del archivo es igual al que se copió en el paso 13 con los cambios de los pasos 14, 18, 23 y 32.

66. En \`${T}/grafana/datasources/datasources.yaml\` cambiar las dos líneas \`basicAuthPassword: mirar-2026\` por esta.

${cod('yaml', '      basicAuthPassword: $__file{/run/secretos/mirar}')}

67. Reemplazar todo el contenido de \`compose.seguridad.yaml\` por este. Prometheus y Grafana montan la carpeta de secretos, la clave de OAuth se lee con \`__FILE\` y lo mismo la clave de admin.

${cod('yaml', compose(10))}

${aplicar(68)}

69. Buscar claves en el compose. Solo quedan nombres de variables y rutas de archivos.

${cod('bash', "grep -n -i -E 'password|secret' Capitulo7/compose.seguridad.yaml")}

${img(39, 'sin claves en el compose')}

### La superficie otra vez

Con los guardias puestos se vuelve a recorrer el perímetro.
Las mismas pruebas del principio muestran qué cambió en cada puerta.
El resultado se compara con lo que se anotó al inicio.

70. Repetir las pruebas del principio contra los mismos puertos.

${cod('bash', `curl -s -o /dev/null -w 'node_exporter por http   %{http_code}\\n' http://localhost:9100/metrics
curl -s -o /dev/null -w 'node_exporter sin clave  %{http_code}\\n' --cacert ${CA} https://localhost:9100/metrics
curl -s -o /dev/null -w 'configuración sin clave  %{http_code}\\n' --cacert ${CA} https://localhost:9090/api/v1/status/config
curl -s -o /dev/null -w 'destinos sin clave       %{http_code}\\n' --cacert ${CA} https://localhost:9090/api/v1/targets`)}

${img(40, 'superficie después')}

>**Nota.** Por http node_exporter responde 400, porque ahora solo habla TLS. Por https sin clave, 401 en todo.

### Verificar

El script recorre el mercado como lo haría un supervisor de seguridad.
Revisa las puertas, las credenciales y los permisos que se armaron en la práctica.

71. Esperar unos 30 segundos, para que Prometheus vuelva a raspar todos sus destinos después de recrearse, y ejecutar la verificación.

${cod('bash', 'Capitulo7/verificar.sh')}

${img(41, 'verificación')}

## Preguntas frecuentes

**¿Qué diferencia hay entre http y https?**
Con https la conexión va cifrada con TLS y el servidor presenta un certificado. Con http todo viaja en texto plano y cualquiera en el camino lo puede leer.

**¿Qué es un hash bcrypt y por qué no se guarda la clave tal cual?**
El hash es una transformación de la clave que no se puede revertir. El servidor calcula el hash de lo que llega y lo compara con el guardado, así que quien lea el archivo no obtiene la clave.

**¿Por qué la capa va en un archivo aparte y no se edita \`infra/compose.yaml\`?**
Compose suma los dos archivos y el segundo cambia solo lo que declara. Así la configuración de \`infra\` queda intacta y volver atrás es dejar de usar la capa.

**¿Qué hace \`kill -HUP 1\` en el contenedor de Prometheus?**
Le manda a Prometheus la señal HUP, que le pide releer \`prometheus.yml\` sin reiniciar el contenedor. Dentro del contenedor Prometheus es el proceso número 1.

**¿Qué es OAuth?**
Es un protocolo con el que una aplicación deja en manos de otra la tarea de identificar a las personas. Grafana manda al navegador a Dex, Dex pide la clave y después le confirma a Grafana quién entró.

**¿Qué diferencia hay entre un usuario y una cuenta de servicio?**
El usuario es una persona que entra por la interfaz. La cuenta de servicio es una identidad para scripts y herramientas, con su propio rol y sus tokens, que no depende de ninguna persona.

**¿Por qué el token se guarda en un archivo y no se escribe en el comando?**
Escrito en el comando queda en el historial de la terminal. Con \`$(cat archivo)\` la terminal lo lee del archivo en el momento de llamar a curl.

## Resultado esperado

node_exporter, Prometheus y Alertmanager hablan solo TLS y piden clave. Prometheus raspa y envía alertas por TLS con credenciales que lee de archivos. Grafana responde por HTTPS con un certificado de la CA del curso, acepta el login con Dex y separa lo que ve cada usuario con roles, un equipo y una carpeta restringida. El token de la cuenta de servicio quedó revocado y ninguna clave está escrita en el compose.

${img(42, 'resultado')}

## Volver al stack base

72. La Práctica 8 necesita el stack sin la capa de seguridad. Ejecutar el siguiente script y escribir \`SI\`. Baja la capa, borra \`${T}\`, devuelve \`compose.seguridad.yaml\` a git y borra en Grafana los usuarios, el equipo, la carpeta y la cuenta de servicio de la práctica.

${cod('bash', 'Capitulo7/restaurar.sh')}

${img(43, 'stack base')}

<!-- instructor -->
La carpeta \`Capitulo7/solucion\` trae \`trabajo\` y \`compose.seguridad.yaml\` resueltos, salvo las claves privadas y los hashes. \`Capitulo7/solucion/generar.sh\` los genera y deja todo listo para aplicar la capa con el comando de los pasos anteriores.

Para ver la práctica resuelta de una vez, \`Capitulo7/solucion/aplicar.sh\` corre \`generar.sh\`, aplica la capa, entra una vez con Dex y crea en Grafana los usuarios, el equipo, la carpeta y la cuenta de servicio con su token revocado. Avisa qué reemplaza y pide escribir SI.
<!-- /instructor -->
`;

writeFileSync(join(RAIZ, 'Capitulo7', 'README.md'), guia);
console.log('Capitulo7/README.md');
