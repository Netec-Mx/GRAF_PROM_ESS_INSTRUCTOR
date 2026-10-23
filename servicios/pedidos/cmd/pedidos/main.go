// Comando pedidos: el servicio de pedidos de Tianguis Digital.
//
// Sin argumentos levanta el servidor HTTP. Con el argumento healthcheck consulta /salud del
// propio servicio y sale con 0 o 1; lo usa el healthcheck del contenedor, que no tiene shell.
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/RodrigoMSB/graf-prom-ess/servicios/pedidos/internal/api"
	"github.com/RodrigoMSB/graf-prom-ess/servicios/pedidos/internal/aplicacion"
	"github.com/RodrigoMSB/graf-prom-ess/servicios/pedidos/internal/caos"
	"github.com/RodrigoMSB/graf-prom-ess/servicios/pedidos/internal/infraestructura"
	"github.com/RodrigoMSB/graf-prom-ess/servicios/pedidos/internal/metricas"
)

const (
	subcomandoHealthcheck = "healthcheck"
	esperaDeApagado       = 10 * time.Second
	esperaDeHealthcheck   = 3 * time.Second
	// pasoDelCaos es cada cuánto el caos revisa si venció una falla y hace crecer la fuga.
	pasoDelCaos = time.Second
)

// configuracion son las variables de entorno del servicio.
type configuracion struct {
	catalogoURL     string
	catalogoTimeout time.Duration
	puerto          int
	// tokenDeCaos vacío significa que /caos no existe.
	tokenDeCaos string
}

func main() {
	logger := api.NuevoLogger(os.Stdout)

	config, err := leerConfiguracion()
	if err != nil {
		logger.LogAttrs(context.Background(), slog.LevelError, "configuración inválida", slog.String("error", err.Error()))
		os.Exit(1)
	}

	if len(os.Args) > 1 {
		if os.Args[1] != subcomandoHealthcheck {
			fmt.Fprintf(os.Stderr, "uso: pedidos [%s]\n", subcomandoHealthcheck)
			os.Exit(2)
		}
		if err := healthcheck(config.puerto); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		return
	}

	if err := servir(config, logger); err != nil {
		logger.LogAttrs(context.Background(), slog.LevelError, "el servicio terminó con error", slog.String("error", err.Error()))
		os.Exit(1)
	}
}

func leerConfiguracion() (configuracion, error) {
	config := configuracion{
		catalogoURL:     entorno("CATALOGO_URL", "http://catalogo:8000"),
		catalogoTimeout: 2 * time.Second,
		puerto:          8080,
		tokenDeCaos:     os.Getenv("CAOS_TOKEN"),
	}
	if texto := os.Getenv("CATALOGO_TIMEOUT"); texto != "" {
		timeout, err := time.ParseDuration(texto)
		if err != nil || timeout <= 0 {
			return configuracion{}, fmt.Errorf("CATALOGO_TIMEOUT inválido: %q debe ser una duración como 2s", texto)
		}
		config.catalogoTimeout = timeout
	}
	if texto := os.Getenv("PUERTO"); texto != "" {
		puerto, err := strconv.Atoi(texto)
		if err != nil || puerto < 1 || puerto > 65535 {
			return configuracion{}, fmt.Errorf("PUERTO inválido: %q", texto)
		}
		config.puerto = puerto
	}
	return config, nil
}

func entorno(nombre, porDefecto string) string {
	if valor := os.Getenv(nombre); valor != "" {
		return valor
	}
	return porDefecto
}

// servir arma la aplicación y atiende hasta recibir SIGINT o SIGTERM.
func servir(config configuracion, logger *slog.Logger) error {
	m := metricas.Nuevas()
	catalogo, err := infraestructura.NuevoClienteCatalogo(config.catalogoURL, config.catalogoTimeout, m)
	if err != nil {
		return err
	}
	repositorio := infraestructura.NuevoRepositorioEnMemoria(infraestructura.CapacidadPorDefecto)
	pedidos := aplicacion.NuevosPedidos(catalogo, repositorio, m, time.Now)

	estadoDeCaos := caos.NuevoEstado(api.RutasDeNegocio(), time.Now, logger)
	m.PublicarCaos(estadoDeCaos)
	rutas := api.NuevasRutas(pedidos, m, logger,
		api.InyectorDeFallas(estadoDeCaos, logger, api.DormirDeVerdad, api.AzarDeVerdad))
	if config.tokenDeCaos != "" {
		api.RegistrarCaos(rutas, estadoDeCaos, config.tokenDeCaos, logger)
	}

	// El primero de la lista queda más afuera. Un middleware nuevo se suma aquí.
	manejador := api.Encadenar(rutas,
		api.MiddlewareDeLogs(logger),
		api.MiddlewareDeMetricas(m, func() bool { return estadoDeCaos.Activa(caos.Cardinalidad) }),
		api.MiddlewareDeRecuperacion(logger),
	)

	servidor := &http.Server{
		Addr:              net.JoinHostPort("", strconv.Itoa(config.puerto)),
		Handler:           manejador,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	ctx, cancelar := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancelar()

	go caos.NuevoMotor(estadoDeCaos, &caos.Fuga{}).Correr(ctx, pasoDelCaos)

	falla := make(chan error, 1)
	go func() { falla <- servidor.ListenAndServe() }()
	logger.LogAttrs(ctx, slog.LevelInfo, "servicio iniciado",
		slog.Int("puerto", config.puerto), slog.String("catalogo_url", config.catalogoURL),
		slog.Bool("caos_habilitado", config.tokenDeCaos != ""))

	select {
	case err := <-falla:
		return err
	case <-ctx.Done():
	}

	logger.LogAttrs(context.Background(), slog.LevelInfo, "apagando el servicio")
	ctxApagado, cancelarApagado := context.WithTimeout(context.Background(), esperaDeApagado)
	defer cancelarApagado()
	if err := servidor.Shutdown(ctxApagado); err != nil {
		return fmt.Errorf("apagado incompleto: %w", err)
	}
	if err := <-falla; !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

// healthcheck consulta /salud en el propio contenedor.
func healthcheck(puerto int) error {
	ctx, cancelar := context.WithTimeout(context.Background(), esperaDeHealthcheck)
	defer cancelar()

	destino := "http://" + net.JoinHostPort("127.0.0.1", strconv.Itoa(puerto)) + "/salud"
	peticion, err := http.NewRequestWithContext(ctx, http.MethodGet, destino, http.NoBody)
	if err != nil {
		return err
	}
	respuesta, err := http.DefaultClient.Do(peticion)
	if err != nil {
		return err
	}
	defer func() { _ = respuesta.Body.Close() }()
	if respuesta.StatusCode != http.StatusOK {
		return fmt.Errorf("/salud respondió %d", respuesta.StatusCode)
	}
	return nil
}
