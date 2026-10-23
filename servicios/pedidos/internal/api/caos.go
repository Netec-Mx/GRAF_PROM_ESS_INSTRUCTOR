package api

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"errors"
	"io"
	"log/slog"
	"math/big"
	"net/http"
	"strings"
	"time"

	"github.com/RodrigoMSB/graf-prom-ess/servicios/pedidos/internal/caos"
)

const (
	rutaCaos = "/caos"
	// CabeceraDeCaos es la cabecera obligatoria en todas las rutas de /caos. Lleva el token.
	CabeceraDeCaos = "X-Caos-Token"
	// maxCuerpoDeCaos acota el tamaño del cuerpo de PUT /caos/{tipo}.
	maxCuerpoDeCaos = 4 * 1024
)

// Dormir espera el tiempo indicado, o menos si el contexto se cancela.
type Dormir func(ctx context.Context, espera time.Duration)

// Azar devuelve un entero al azar entre 0 y n-1.
type Azar func(n int) int

// DormirDeVerdad espera con un temporizador. Si el cliente se va, deja de esperar.
func DormirDeVerdad(ctx context.Context, espera time.Duration) {
	temporizador := time.NewTimer(espera)
	defer temporizador.Stop()
	select {
	case <-temporizador.C:
	case <-ctx.Done():
	}
}

// AzarDeVerdad sortea con el generador del sistema.
func AzarDeVerdad(n int) int {
	sorteo, err := rand.Int(rand.Reader, big.NewInt(int64(n)))
	if err != nil {
		// Sin azar no se inyecta nada: 0 sería "siempre le toca".
		return n - 1
	}
	return int(sorteo.Int64())
}

// InyectorDeFallas devuelve el decorador que aplica latencia y errores a un handler de
// negocio. Va por dentro del ServeMux, así conoce la plantilla de la ruta, y por dentro de
// los middlewares de métricas y de logs, que ven la demora y el código de error.
func InyectorDeFallas(estado *caos.Estado, logger *slog.Logger, dormir Dormir, azar Azar) Middleware {
	leToca := func(falla caos.Falla, ruta string) bool {
		return falla.AplicaA(ruta) && azar(100) < falla.Enteros[caos.ParamPorcentaje]
	}
	return func(siguiente http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, peticion *http.Request) {
			ruta := plantillaDeRuta(peticion)
			if latencia, vigente := estado.Vigente(caos.Latencia); vigente && leToca(latencia, ruta) {
				ms := latencia.Enteros[caos.ParamMs] + azar(latencia.Enteros[caos.ParamJitterMs]+1)
				dormir(peticion.Context(), time.Duration(ms)*time.Millisecond)
			}
			if errores, vigente := estado.Vigente(caos.Errores); vigente && leToca(errores, ruta) {
				escribirError(w, logger, errores.Enteros[caos.ParamStatus], "error_inyectado", "Error inyectado por caos")
				return
			}
			siguiente.ServeHTTP(w, peticion)
		})
	}
}

// sinFallas es el decorador que no hace nada.
func sinFallas(siguiente http.Handler) http.Handler {
	return siguiente
}

type estadoDeCaosSalida struct {
	Servicio string             `json:"servicio"`
	Fallas   []caos.Descripcion `json:"fallas"`
}

type manejadoresDeCaos struct {
	estado *caos.Estado
	// huellaDelToken es el SHA-256 del token: comparar huellas no revela el largo del token.
	huellaDelToken [sha256.Size]byte
	logger         *slog.Logger
}

// RegistrarCaos agrega las rutas de /caos al ServeMux. Solo se llama si hay token: sin
// token, /caos no existe y responde 404 como cualquier ruta desconocida.
func RegistrarCaos(mux *http.ServeMux, estado *caos.Estado, token string, logger *slog.Logger) {
	h := &manejadoresDeCaos{estado: estado, huellaDelToken: sha256.Sum256([]byte(token)), logger: logger}
	mux.HandleFunc("GET "+rutaCaos, h.conToken(h.ver))
	mux.HandleFunc("PUT "+rutaCaos+"/{tipo}", h.conToken(h.activar))
	mux.HandleFunc("DELETE "+rutaCaos+"/{tipo}", h.conToken(h.apagar))
	mux.HandleFunc("DELETE "+rutaCaos, h.conToken(h.apagarTodo))
}

func (h *manejadoresDeCaos) conToken(siguiente http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, peticion *http.Request) {
		huella := sha256.Sum256([]byte(peticion.Header.Get(CabeceraDeCaos)))
		// ConstantTimeCompare tarda lo mismo acierte o no: no deja adivinar el token por tiempos.
		if subtle.ConstantTimeCompare(huella[:], h.huellaDelToken[:]) != 1 {
			// El intento queda en el log, sin el token que mandaron.
			h.logger.LogAttrs(peticion.Context(), slog.LevelWarn, "acceso a caos rechazado",
				slog.String("method", metodoAcotado(peticion.Method)),
				slog.String("route", plantillaDeRuta(peticion)),
				slog.Int("status", http.StatusUnauthorized),
			)
			escribirError(w, h.logger, http.StatusUnauthorized, "token_invalido", "Falta "+CabeceraDeCaos+" o no coincide")
			return
		}
		siguiente(w, peticion)
	}
}

func (h *manejadoresDeCaos) ver(w http.ResponseWriter, _ *http.Request) {
	escribirJSON(w, h.logger, http.StatusOK, estadoDeCaosSalida{Servicio: Servicio, Fallas: h.estado.Resumen()})
}

func (h *manejadoresDeCaos) activar(w http.ResponseWriter, peticion *http.Request) {
	tipo := peticion.PathValue("tipo")
	cuerpo, err := io.ReadAll(http.MaxBytesReader(w, peticion.Body, maxCuerpoDeCaos))
	if err != nil {
		var demasiado *http.MaxBytesError
		if errors.As(err, &demasiado) {
			escribirError(w, h.logger, http.StatusRequestEntityTooLarge, "cuerpo_demasiado_grande", "El cuerpo no puede pasar de 4 KB")
			return
		}
		escribirError(w, h.logger, http.StatusBadRequest, "parametros_invalidos", "No se pudo leer el cuerpo")
		return
	}
	if _, err := h.estado.Activar(tipo, cuerpo); err != nil {
		h.rechazar(w, tipo, err)
		return
	}
	escribirJSON(w, h.logger, http.StatusOK, h.estado.Describir(tipo))
}

func (h *manejadoresDeCaos) apagar(w http.ResponseWriter, peticion *http.Request) {
	tipo := peticion.PathValue("tipo")
	if err := h.estado.Apagar(tipo); err != nil {
		h.rechazar(w, tipo, err)
		return
	}
	escribirJSON(w, h.logger, http.StatusOK, h.estado.Describir(tipo))
}

func (h *manejadoresDeCaos) apagarTodo(w http.ResponseWriter, peticion *http.Request) {
	h.estado.ApagarTodo()
	h.ver(w, peticion)
}

func (h *manejadoresDeCaos) rechazar(w http.ResponseWriter, tipo string, err error) {
	if errors.Is(err, caos.ErrFallaDesconocida) {
		escribirError(w, h.logger, http.StatusNotFound, "falla_desconocida", Servicio+" no tiene una falla llamada "+tipo)
		return
	}
	mensaje := strings.TrimPrefix(err.Error(), caos.ErrParametrosInvalidos.Error()+": ")
	escribirError(w, h.logger, http.StatusBadRequest, "parametros_invalidos", mensaje)
}
