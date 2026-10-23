package api_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/prometheus/client_golang/prometheus/testutil"

	"github.com/RodrigoMSB/graf-prom-ess/servicios/pedidos/internal/api"
	"github.com/RodrigoMSB/graf-prom-ess/servicios/pedidos/internal/aplicacion"
	"github.com/RodrigoMSB/graf-prom-ess/servicios/pedidos/internal/caos"
	"github.com/RodrigoMSB/graf-prom-ess/servicios/pedidos/internal/infraestructura"
	"github.com/RodrigoMSB/graf-prom-ess/servicios/pedidos/internal/metricas"
)

const llaveDePrueba = "llave-de-prueba"

// servicioConCaos es la app armada igual que main, con reloj, siesta y azar de prueba.
type servicioConCaos struct {
	manejador http.Handler
	metricas  *metricas.Metricas
	estado    *caos.Estado
	logs      *bytes.Buffer
	ahora     time.Time
	// siestas son las esperas que pidió la falla latencia.
	siestas []time.Duration
	// sorteo es lo que devuelve el azar, como fracción de n: 0.29 con n=100 da 29.
	sorteo float64
}

func nuevoServicioConCaos(token string) *servicioConCaos {
	s := &servicioConCaos{
		metricas: metricas.Nuevas(),
		logs:     &bytes.Buffer{},
		ahora:    time.Date(2026, 10, 12, 12, 0, 0, 0, time.UTC),
	}
	logger := api.NuevoLogger(s.logs)
	s.estado = caos.NuevoEstado(api.RutasDeNegocio(), func() time.Time { return s.ahora }, logger)
	s.metricas.PublicarCaos(s.estado)
	pedidos := aplicacion.NuevosPedidos(&catalogoFalso{}, infraestructura.NuevoRepositorioEnMemoria(100), s.metricas, time.Now)

	dormir := func(_ context.Context, espera time.Duration) { s.siestas = append(s.siestas, espera) }
	azar := func(n int) int { return int(s.sorteo * float64(n)) }
	rutas := api.NuevasRutas(pedidos, s.metricas, logger, api.InyectorDeFallas(s.estado, logger, dormir, azar))
	if token != "" {
		api.RegistrarCaos(rutas, s.estado, token, logger)
	}
	s.manejador = api.Encadenar(rutas,
		api.MiddlewareDeLogs(logger),
		api.MiddlewareDeMetricas(s.metricas, func() bool { return s.estado.Activa(caos.Cardinalidad) }),
		api.MiddlewareDeRecuperacion(logger),
	)
	return s
}

func (s *servicioConCaos) pedir(metodo, ruta, token, cuerpo string) *httptest.ResponseRecorder {
	peticion := httptest.NewRequestWithContext(context.Background(), metodo, ruta, strings.NewReader(cuerpo))
	if token != "" {
		peticion.Header.Set(api.CabeceraDeCaos, token)
	}
	respuesta := httptest.NewRecorder()
	s.manejador.ServeHTTP(respuesta, peticion)
	return respuesta
}

func (s *servicioConCaos) caos(metodo, ruta, cuerpo string) *httptest.ResponseRecorder {
	return s.pedir(metodo, ruta, llaveDePrueba, cuerpo)
}

func (s *servicioConCaos) activar(t *testing.T, tipo, cuerpo string) {
	t.Helper()
	if respuesta := s.caos(http.MethodPut, "/caos/"+tipo, cuerpo); respuesta.Code != http.StatusOK {
		t.Fatalf("PUT /caos/%s = %d: %s", tipo, respuesta.Code, respuesta.Body)
	}
}

// conteo devuelve cuántas peticiones GET se contaron con esa ruta y ese código.
func (s *servicioConCaos) conteo(ruta, estado string) float64 {
	return testutil.ToFloat64(s.metricas.PeticionesServidor.WithLabelValues(http.MethodGet, ruta, estado))
}

// chaosActive lee chaos_active desde /metrics, como lo vería Prometheus.
func (s *servicioConCaos) chaosActive(t *testing.T) map[string]string {
	t.Helper()
	valores := map[string]string{}
	for linea := range strings.Lines(s.pedir(http.MethodGet, "/metrics", "", "").Body.String()) {
		resto, esDeCaos := strings.CutPrefix(linea, `chaos_active{type="`)
		if !esDeCaos {
			continue
		}
		tipo, valor, _ := strings.Cut(strings.TrimSpace(resto), `"} `)
		valores[tipo] = valor
	}
	return valores
}

func codigoDeError(t *testing.T, respuesta *httptest.ResponseRecorder) string {
	t.Helper()
	var cuerpo struct {
		Error string `json:"error"`
	}
	if err := json.Unmarshal(respuesta.Body.Bytes(), &cuerpo); err != nil {
		t.Fatalf("la respuesta no es JSON: %q", respuesta.Body.String())
	}
	return cuerpo.Error
}

func rutasDeCaos() []struct{ metodo, ruta string } {
	return []struct{ metodo, ruta string }{
		{http.MethodGet, "/caos"},
		{http.MethodPut, "/caos/latencia"},
		{http.MethodDelete, "/caos/latencia"},
		{http.MethodDelete, "/caos"},
	}
}

func TestCaosSinTokenOConOtroResponde401(t *testing.T) {
	for _, token := range []string{"", "otro", llaveDePrueba + "x", llaveDePrueba[:5]} {
		for _, caso := range rutasDeCaos() {
			s := nuevoServicioConCaos(llaveDePrueba)
			respuesta := s.pedir(caso.metodo, caso.ruta, token, `{"ms":100}`)
			if respuesta.Code != http.StatusUnauthorized || codigoDeError(t, respuesta) != "token_invalido" {
				t.Errorf("%s %s con token %q = %d %s", caso.metodo, caso.ruta, token, respuesta.Code, respuesta.Body)
			}
			if s.estado.Activa(caos.Latencia) {
				t.Errorf("%s %s con token %q encendió la falla", caso.metodo, caso.ruta, token)
			}
		}
	}
}

func TestUnIntentoRechazadoDejaSuLineaDeLogSinElToken(t *testing.T) {
	s := nuevoServicioConCaos(llaveDePrueba)

	s.pedir(http.MethodPut, "/caos/latencia", "intento-secreto", `{"ms":100}`)
	s.pedir(http.MethodGet, "/caos", "", "")
	_ = s.caos(http.MethodGet, "/caos", "")

	var rechazos []string
	for linea := range strings.Lines(s.logs.String()) {
		var campos struct {
			Msg     string `json:"msg"`
			Nivel   string `json:"level"`
			Service string `json:"service"`
			Method  string `json:"method"`
			Route   string `json:"route"`
			Status  int    `json:"status"`
		}
		if err := json.Unmarshal([]byte(linea), &campos); err != nil {
			t.Fatalf("línea de log que no es JSON: %q", linea)
		}
		if campos.Msg != "acceso a caos rechazado" {
			continue
		}
		if campos.Service != "pedidos" || campos.Nivel != "warning" || campos.Status != http.StatusUnauthorized {
			t.Errorf("línea de rechazo = %+v", campos)
		}
		rechazos = append(rechazos, campos.Method+" "+campos.Route)
	}
	if len(rechazos) != 2 || rechazos[0] != "PUT /caos/{tipo}" || rechazos[1] != "GET /caos" {
		t.Errorf("rechazos = %v", rechazos)
	}
	if strings.Contains(s.logs.String(), "intento-secreto") || strings.Contains(s.logs.String(), llaveDePrueba) {
		t.Errorf("el token quedó en el log: %s", s.logs)
	}
}

func TestConElTokenVacioCaosNoExiste(t *testing.T) {
	for _, caso := range rutasDeCaos() {
		s := nuevoServicioConCaos("")
		for _, token := range []string{"", llaveDePrueba} {
			if respuesta := s.pedir(caso.metodo, caso.ruta, token, `{"ms":100}`); respuesta.Code != http.StatusNotFound {
				t.Errorf("%s %s = %d, quería 404", caso.metodo, caso.ruta, respuesta.Code)
			}
		}
	}
}

func TestCaosCuerpoDeMasDe4KBResponde413(t *testing.T) {
	s := nuevoServicioConCaos(llaveDePrueba)

	respuesta := s.caos(http.MethodPut, "/caos/latencia", `{"ms":100,"ruta":"`+strings.Repeat("x", 4096)+`"}`)

	if respuesta.Code != http.StatusRequestEntityTooLarge {
		t.Errorf("código = %d, quería 413", respuesta.Code)
	}
	if s.estado.Activa(caos.Latencia) {
		t.Error("un cuerpo rechazado no debe encender nada")
	}
}

func TestCaosContrato(t *testing.T) {
	s := nuevoServicioConCaos(llaveDePrueba)

	apagado := `{"servicio":"pedidos","fallas":[` +
		`{"tipo":"latencia","activa":false,"restante_s":null,"parametros":{}},` +
		`{"tipo":"errores","activa":false,"restante_s":null,"parametros":{}},` +
		`{"tipo":"cardinalidad","activa":false,"restante_s":null,"parametros":{}},` +
		`{"tipo":"memoria","activa":false,"restante_s":null,"parametros":{}}]}`
	if cuerpo := strings.TrimSpace(s.caos(http.MethodGet, "/caos", "").Body.String()); cuerpo != apagado {
		t.Errorf("GET /caos =\n%s\nquería\n%s", cuerpo, apagado)
	}

	respuesta := s.caos(http.MethodPut, "/caos/latencia", `{"ms":800,"duracion_s":60}`)
	esperado := `{"tipo":"latencia","activa":true,"restante_s":60,"parametros":{"jitter_ms":0,"ms":800,"porcentaje":100}}`
	if respuesta.Code != http.StatusOK || strings.TrimSpace(respuesta.Body.String()) != esperado {
		t.Errorf("PUT /caos/latencia = %d %s", respuesta.Code, respuesta.Body)
	}
	s.activar(t, caos.Cardinalidad, "")

	respuesta = s.caos(http.MethodDelete, "/caos/latencia", "")
	if respuesta.Code != http.StatusOK || !strings.Contains(respuesta.Body.String(), `"activa":false`) {
		t.Errorf("DELETE /caos/latencia = %d %s", respuesta.Code, respuesta.Body)
	}
	if s.estado.Activa(caos.Latencia) || !s.estado.Activa(caos.Cardinalidad) {
		t.Error("DELETE /caos/latencia debe apagar solo latencia")
	}

	respuesta = s.caos(http.MethodDelete, "/caos", "")
	if respuesta.Code != http.StatusOK || strings.TrimSpace(respuesta.Body.String()) != apagado {
		t.Errorf("DELETE /caos = %d %s", respuesta.Code, respuesta.Body)
	}
}

func TestCaosErroresDelContrato(t *testing.T) {
	s := nuevoServicioConCaos(llaveDePrueba)
	casos := []struct {
		metodo, ruta, cuerpo string
		codigo               int
		clave                string
	}{
		{http.MethodPut, "/caos/pasarela_lenta", `{}`, http.StatusNotFound, "falla_desconocida"},
		{http.MethodDelete, "/caos/pasarela_lenta", ``, http.StatusNotFound, "falla_desconocida"},
		{http.MethodPut, "/caos/latencia", `{}`, http.StatusBadRequest, "parametros_invalidos"},
		{http.MethodPut, "/caos/latencia", `{"ms":10001}`, http.StatusBadRequest, "parametros_invalidos"},
		{http.MethodPut, "/caos/latencia", `ms=800`, http.StatusBadRequest, "parametros_invalidos"},
		{http.MethodPut, "/caos/errores", `{"status":404}`, http.StatusBadRequest, "parametros_invalidos"},
	}
	for _, caso := range casos {
		respuesta := s.caos(caso.metodo, caso.ruta, caso.cuerpo)
		if respuesta.Code != caso.codigo || codigoDeError(t, respuesta) != caso.clave {
			t.Errorf("%s %s %s = %d %s", caso.metodo, caso.ruta, caso.cuerpo, respuesta.Code, respuesta.Body)
		}
	}
}

func TestLatenciaDemoraLasRutasDeNegocio(t *testing.T) {
	s := nuevoServicioConCaos(llaveDePrueba)
	s.sorteo = 0.5
	s.activar(t, caos.Latencia, `{"ms":800,"jitter_ms":200,"porcentaje":51}`)

	s.pedir(http.MethodGet, "/pedidos", "", "")
	s.pedir(http.MethodGet, "/pedidos/PED-000001", "", "")
	s.pedir(http.MethodPost, "/pedidos", "", `{"lineas":[{"sku":"TNG-0001","cantidad":1}]}`)

	// 800 ms fijos más la mitad del jitter, porque el sorteo es 0.5.
	if len(s.siestas) != 3 || s.siestas[0] != 900*time.Millisecond {
		t.Errorf("siestas = %v, quería tres de 900ms", s.siestas)
	}

	s.sorteo = 0.51
	s.pedir(http.MethodGet, "/pedidos", "", "")
	if len(s.siestas) != 3 {
		t.Error("con el sorteo en 51 y porcentaje 51, a esta petición no le toca")
	}
}

func TestLatenciaConRutaSoloAfectaAEsaPlantilla(t *testing.T) {
	s := nuevoServicioConCaos(llaveDePrueba)
	s.activar(t, caos.Latencia, `{"ms":500,"ruta":"/pedidos/{id}"}`)

	s.pedir(http.MethodGet, "/pedidos", "", "")
	if len(s.siestas) != 0 {
		t.Fatalf("la falla alcanzó a /pedidos: %v", s.siestas)
	}
	s.pedir(http.MethodGet, "/pedidos/PED-000001", "", "")
	if len(s.siestas) != 1 || s.siestas[0] != 500*time.Millisecond {
		t.Errorf("siestas = %v", s.siestas)
	}
}

func TestErroresRespondeElStatusPedidoYLoCuentaConLaPlantilla(t *testing.T) {
	s := nuevoServicioConCaos(llaveDePrueba)
	s.sorteo = 0.29
	s.activar(t, caos.Errores, `{"porcentaje":30,"status":503}`)

	respuesta := s.pedir(http.MethodGet, "/pedidos/PED-000001", "", "")
	if respuesta.Code != http.StatusServiceUnavailable || codigoDeError(t, respuesta) != "error_inyectado" {
		t.Errorf("respuesta = %d %s", respuesta.Code, respuesta.Body)
	}
	if s.conteo("/pedidos/{id}", "503") != 1 {
		t.Error("el error inyectado debe contarse con la plantilla de la ruta")
	}

	s.sorteo = 0.30
	if respuesta := s.pedir(http.MethodGet, "/pedidos", "", ""); respuesta.Code != http.StatusOK {
		t.Errorf("con el sorteo en 30 y porcentaje 30 no le toca: %d", respuesta.Code)
	}
}

func TestUnPedidoConErrorInyectadoNoSeCrea(t *testing.T) {
	s := nuevoServicioConCaos(llaveDePrueba)
	s.activar(t, caos.Errores, `{"status":500}`)

	s.pedir(http.MethodPost, "/pedidos", "", `{"lineas":[{"sku":"TNG-0001","cantidad":1}]}`)
	_ = s.caos(http.MethodDelete, "/caos", "")

	if cuerpo := s.pedir(http.MethodGet, "/pedidos", "", "").Body.String(); !strings.Contains(cuerpo, `"total":0`) {
		t.Errorf("el pedido se creó a pesar del error: %s", cuerpo)
	}
}

func TestLasFallasNoTocanSaludNiMetricsNiCaos(t *testing.T) {
	s := nuevoServicioConCaos(llaveDePrueba)
	s.activar(t, caos.Latencia, `{"ms":10000}`)
	s.activar(t, caos.Errores, `{"status":500}`)

	for _, ruta := range []string{"/salud", "/metrics"} {
		if respuesta := s.pedir(http.MethodGet, ruta, "", ""); respuesta.Code != http.StatusOK {
			t.Errorf("GET %s = %d", ruta, respuesta.Code)
		}
	}
	if respuesta := s.caos(http.MethodGet, "/caos", ""); respuesta.Code != http.StatusOK {
		t.Errorf("GET /caos = %d", respuesta.Code)
	}
	if len(s.siestas) != 0 {
		t.Errorf("hubo demora en rutas de plataforma: %v", s.siestas)
	}
}

func TestCardinalidadPoneLaRutaRealYAlApagarlaVuelveLaPlantilla(t *testing.T) {
	s := nuevoServicioConCaos(llaveDePrueba)
	s.activar(t, caos.Cardinalidad, "")

	s.pedir(http.MethodGet, "/pedidos/PED-000001", "", "")
	s.pedir(http.MethodGet, "/pedidos/PED-000002", "", "")
	s.pedir(http.MethodGet, "/no-existe/123", "", "")

	if s.conteo("/pedidos/PED-000001", "404") != 1 || s.conteo("/pedidos/PED-000002", "404") != 1 {
		t.Error("con cardinalidad activa cada id debe tener su serie")
	}
	if s.conteo("/pedidos/{id}", "404") != 0 {
		t.Error("con cardinalidad activa no debe contarse con la plantilla")
	}
	if s.conteo(api.RutaDesconocida, "404") != 1 || s.conteo("/no-existe/123", "404") != 0 {
		t.Error("una petición sin ruta sigue como unmatched")
	}

	_ = s.caos(http.MethodDelete, "/caos/cardinalidad", "")
	s.pedir(http.MethodGet, "/pedidos/PED-000001", "", "")

	if s.conteo("/pedidos/{id}", "404") != 1 || s.conteo("/pedidos/PED-000001", "404") != 1 {
		t.Error("al apagar cardinalidad las peticiones nuevas vuelven a la plantilla")
	}
}

func TestCaosNoCuentaEnLasMetricasHTTPNiDejaLineaDePeticion(t *testing.T) {
	s := nuevoServicioConCaos(llaveDePrueba)

	_ = s.caos(http.MethodGet, "/caos", "")
	s.activar(t, caos.Cardinalidad, "")
	_ = s.pedir(http.MethodGet, "/caos", "", "")
	_ = s.caos(http.MethodPut, "/caos/inventada", "")
	_ = s.caos(http.MethodDelete, "/caos", "")

	if total := testutil.CollectAndCount(s.metricas.PeticionesServidor); total != 0 {
		t.Errorf("/caos creó %d series de peticiones", total)
	}
	if strings.Contains(s.logs.String(), "peticion atendida") {
		t.Errorf("/caos dejó una línea de petición: %s", s.logs)
	}
	if !strings.Contains(s.logs.String(), `"msg":"caos activado"`) || !strings.Contains(s.logs.String(), `"msg":"caos apagado"`) {
		t.Errorf("faltan las líneas de cambio: %s", s.logs)
	}
}

func TestChaosActiveTieneUnaSeriePorFallaYSigueAlEstado(t *testing.T) {
	s := nuevoServicioConCaos(llaveDePrueba)

	valores := s.chaosActive(t)
	for _, tipo := range caos.Tipos() {
		if valores[tipo] != "0" {
			t.Errorf("chaos_active{type=%q} = %q, quería 0", tipo, valores[tipo])
		}
	}

	s.activar(t, caos.Latencia, `{"ms":800,"duracion_s":60}`)
	if valores := s.chaosActive(t); valores[caos.Latencia] != "1" || valores[caos.Errores] != "0" {
		t.Errorf("con latencia activa: %v", valores)
	}

	s.ahora = s.ahora.Add(60 * time.Second)
	if valores := s.chaosActive(t); valores[caos.Latencia] != "0" {
		t.Errorf("vencida la falla, chaos_active debe volver a 0: %v", valores)
	}
}

func TestChaosActiveExisteAunqueElCaosEsteDeshabilitado(t *testing.T) {
	s := nuevoServicioConCaos("")

	if valores := s.chaosActive(t); len(valores) != len(caos.Tipos()) {
		t.Errorf("chaos_active = %v, quería una serie por falla", valores)
	}
}

func TestDormirDeVerdadDejaDeEsperarSiElClienteSeVa(t *testing.T) {
	ctx, cancelar := context.WithCancel(t.Context())
	cancelar()
	inicio := time.Now()

	api.DormirDeVerdad(ctx, 10*time.Second)

	if time.Since(inicio) > time.Second {
		t.Error("DormirDeVerdad no respetó la cancelación")
	}
}

func TestAzarDeVerdadQuedaEnRango(t *testing.T) {
	for range 200 {
		if sorteo := api.AzarDeVerdad(100); sorteo < 0 || sorteo > 99 {
			t.Fatalf("sorteo fuera de rango: %d", sorteo)
		}
	}
	if api.AzarDeVerdad(1) != 0 {
		t.Error("con n=1 solo puede salir 0")
	}
}
