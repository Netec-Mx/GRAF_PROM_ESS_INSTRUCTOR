# syntax=docker/dockerfile:1
# Las versiones y el checksum llegan desde infra/.env por los build args de infra/compose.yaml.
ARG JAVA_VERSION=25.0.4.1_1

# Etapa 1: compila el jar con el wrapper de Maven. Las pruebas se corren aparte, con ./mvnw verify.
FROM eclipse-temurin:${JAVA_VERSION}-jdk AS constructor
# unzip solo existe en esta etapa. El wrapper lo necesita para descargar el .zip de Maven, que
# es el archivo cuyo SHA-256 está fijado en .mvn/wrapper/maven-wrapper.properties. Sin unzip el
# wrapper cambia solo al .tar.gz y ese checksum deja de servir.
RUN apt-get update \
    && apt-get install -y --no-install-recommends unzip \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY mvnw pom.xml ./
COPY .mvn ./.mvn
# Descarga Maven y verifica su checksum. Si no coincide, la construcción falla aquí.
# La caché cubre solo las dependencias, no la distribución de Maven: así Maven se vuelve a
# verificar cada vez que esta capa se reconstruye.
RUN ./mvnw -B -q --version
COPY src ./src
RUN --mount=type=cache,target=/root/.m2/repository ./mvnw -B -q -DskipTests package

# Etapa 2: descarga el agente de OpenTelemetry desde su release oficial y verifica su SHA-256.
# OTEL_AGENT_SHA256 no tiene valor por defecto: sin checksum, o con uno que no coincide, la
# construcción falla.
FROM eclipse-temurin:${JAVA_VERSION}-jdk AS agente
ARG OTEL_AGENT_VERSION
ARG OTEL_AGENT_SHA256
ADD --chmod=644 https://github.com/open-telemetry/opentelemetry-java-instrumentation/releases/download/v${OTEL_AGENT_VERSION}/opentelemetry-javaagent.jar /agente/opentelemetry-javaagent.jar
RUN test -n "${OTEL_AGENT_SHA256}" || { echo "Falta OTEL_AGENT_SHA256: no se acepta el agente sin verificar su checksum" >&2; exit 1; }; \
    echo "${OTEL_AGENT_SHA256}  /agente/opentelemetry-javaagent.jar" | sha256sum -c -

# Etapa 3: imagen final con JRE (sin JDK ni Maven) y usuario no root.
FROM eclipse-temurin:${JAVA_VERSION}-jre
RUN useradd --system --uid 10001 --no-create-home --shell /usr/sbin/nologin pagos
WORKDIR /app
COPY --from=constructor /src/target/pagos.jar /app/pagos.jar
COPY --from=agente /agente/opentelemetry-javaagent.jar /app/opentelemetry-javaagent.jar
USER 10001
EXPOSE 8080
# La imagen no trae curl ni wget y no se le agrega nada: bash abre el socket con /dev/tcp,
# pide /salud y revisa que la primera línea de la respuesta traiga un 200.
HEALTHCHECK --interval=10s --timeout=5s --retries=6 --start-period=60s \
    CMD ["bash", "-c", "exec 3<>/dev/tcp/127.0.0.1/${PUERTO:-8080} && printf 'GET /salud HTTP/1.0\\r\\n\\r\\n' >&3 && read -r linea <&3 && [[ $linea == *' 200'* ]]"]
# El agente va en la línea de comandos y no en JAVA_TOOL_OPTIONS, para que solo lo cargue el servicio.
ENTRYPOINT ["java", "-javaagent:/app/opentelemetry-javaagent.jar", "-XX:MaxRAMPercentage=55", "-jar", "/app/pagos.jar"]
