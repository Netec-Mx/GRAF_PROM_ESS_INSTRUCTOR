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
	"github.com/RodrigoMSB/graf-prom-ess/servicios/pedidos/internal/infraestructura"
	"github.com/RodrigoMSB/graf-prom-ess/servicios/pedidos/internal/metricas"
)

// catalogoFalso responde desde un mapa. Con caido en true simula que catalogo no responde.
type catalogoFalso struct {
	caido bool
}

func (c *catalogoFalso) ObtenerProducto(_ context.Context, sku string) (aplicacion.Producto, error) {
	if c.caido {
		return aplicacion.Producto{}, aplicacion.ErrCatalogoNoDisponible
	}
	productos := map[string]aplicacion.Producto{
		"TNG-0001": {SKU: "TNG-0001", Nombre: "Aguacate Hass (kg)", Precio: 8900, Stock: 40},
		"TNG-0002": {SKU: "TNG-0002", Nombre: "Jitomate saladet (kg)", Precio: 3333, Stock: 10},
		"TNG-0005": {SKU: "TNG-0005", Nombre: "Mango ataulfo (kg)", Precio: 5400, Stock: 0},
	}
	producto, existe := productos[sku]
	if !existe {
		return aplicacion.Producto{}, aplicacion.ErrProductoNoExiste
	}
	return producto, nil
}

type servicio struct {
	manejador http.Handler
	metricas  *metricas.Metricas
	catalogo  *catalogoFalso
	logs      *bytes.Buffer
}

// nuevoServicio arma la app igual que main, con un catálogo falso y los logs en memoria.
func nuevoServicio() *servicio {
	s := &servicio{metricas: metricas.Nuevas(), catalogo: &catalogoFalso{}, logs: &bytes.Buffer{}}
	logger := api.NuevoLogger(s.logs)
	pedidos := aplicacion.NuevosPedidos(s.catalogo, infraestructura.NuevoRepositorioEnMemoria(100), s.metricas, time.Now)
	s.manejador = api.Encadenar(api.NuevasRutas(pedidos, s.metricas, logger, nil),
		api.MiddlewareDeLogs(logger),
		api.MiddlewareDeMetricas(s.metricas, func() bool { return false }),
		api.MiddlewareDeRecuperacion(logger),
	)
	return s
}

func (s *servicio) pedir(metodo, ruta, cuerpo string) *httptest.ResponseRecorder {
	peticion := httptest.NewRequestWithContext(context.Background(), metodo, ruta, strings.NewReader(cuerpo))
	respuesta := httptest.NewRecorder()
	s.manejador.ServeHTTP(respuesta, peticion)
	return respuesta
}

func (s *servicio) conteo(metodo, ruta, estado string) float64 {
	return testutil.ToFloat64(s.metricas.PeticionesServidor.WithLabelValues(metodo, ruta, estado))
}

// lineasDeLog devuelve cada línea de log como un mapa.
func (s *servicio) lineasDeLog(t *testing.T) []map[string]any {
	t.Helper()
	var lineas []map[string]any
	for texto := range strings.Lines(s.logs.String()) {
		var linea map[string]any
		if err := json.Unmarshal([]byte(texto), &linea); err != nil {
			t.Fatalf("línea de log que no es JSON: %q", texto)
		}
		lineas = append(lineas, linea)
	}
	return lineas
}

type pedidoJSON struct {
	ID     string `json:"id"`
	Estado string `json:"estado"`
	Lineas []struct {
		SKU               string `json:"sku"`
		Cantidad          int    `json:"cantidad"`
		Nombre            string `json:"nombre"`
		PrecioUnitarioMXN string `json:"precio_unitario_mxn"`
		SubtotalMXN       string `json:"subtotal_mxn"`
	} `json:"lineas"`
	TotalMXN       string   `json:"total_mxn"`
	SKUsRechazados []string `json:"skus_rechazados"`
	CreadoEn       string   `json:"creado_en"`
}

func decodificar[T any](t *testing.T, respuesta *httptest.ResponseRecorder) T {
	t.Helper()
	var valor T
	if err := json.Unmarshal(respuesta.Body.Bytes(), &valor); err != nil {
		t.Fatalf("respuesta que no es JSON: %q", respuesta.Body.String())
	}
	return valor
}

func TestCrearPedidoConfirmado(t *testing.T) {
	s := nuevoServicio()

	respuesta := s.pedir(http.MethodPost, "/pedidos", `{"lineas":[{"sku":"TNG-0002","cantidad":3},{"sku":"TNG-0001","cantidad":1}]}`)

	if respuesta.Code != http.StatusCreated {
		t.Fatalf("código = %d, cuerpo %s", respuesta.Code, respuesta.Body.String())
	}
	if respuesta.Header().Get("Location") != "/pedidos/PED-000001" {
		t.Errorf("Location = %q", respuesta.Header().Get("Location"))
	}
	pedido := decodificar[pedidoJSON](t, respuesta)
	if pedido.ID != "PED-000001" || pedido.Estado != "confirmado" || pedido.TotalMXN != "188.99" {
		t.Errorf("pedido inesperado: %+v", pedido)
	}
	if pedido.Lineas[0].SubtotalMXN != "99.99" || pedido.Lineas[0].PrecioUnitarioMXN != "33.33" {
		t.Errorf(`3 x "33.33" debía dar "99.99": %+v`, pedido.Lineas[0])
	}
	// El total viaja como texto, no como número JSON.
	if !strings.Contains(respuesta.Body.String(), `"total_mxn":"188.99"`) {
		t.Errorf("total_mxn debía ir como texto: %s", respuesta.Body.String())
	}
}

func TestCrearPedidoRechazadoYCaido(t *testing.T) {
	casos := []struct {
		nombre, cuerpo, estado, resultado string
		caido                             bool
		codigo                            int
	}{
		{"sku inexistente", `{"lineas":[{"sku":"TNG-9999","cantidad":1}]}`, "rechazado_sku_inexistente", "rejected_unknown_sku", false, http.StatusUnprocessableEntity},
		{"sin stock", `{"lineas":[{"sku":"TNG-0005","cantidad":1}]}`, "rechazado_sin_stock", "rejected_out_of_stock", false, http.StatusUnprocessableEntity},
		{"catálogo caído", `{"lineas":[{"sku":"TNG-0001","cantidad":1}]}`, "", "dependency_error", true, http.StatusServiceUnavailable},
	}
	for _, caso := range casos {
		t.Run(caso.nombre, func(t *testing.T) {
			s := nuevoServicio()
			s.catalogo.caido = caso.caido

			respuesta := s.pedir(http.MethodPost, "/pedidos", caso.cuerpo)

			if respuesta.Code != caso.codigo {
				t.Fatalf("código = %d, cuerpo %s", respuesta.Code, respuesta.Body.String())
			}
			if contados := testutil.ToFloat64(s.metricas.PedidosCreados.WithLabelValues(caso.resultado)); contados != 1 {
				t.Errorf(`orders_created_total{result=%q} = %v, esperaba 1`, caso.resultado, contados)
			}
			guardados := decodificar[struct {
				Total int `json:"total"`
			}](t, s.pedir(http.MethodGet, "/pedidos", ""))
			if caso.caido {
				if guardados.Total != 0 {
					t.Errorf("con el catálogo caído no debía guardarse nada, hay %d", guardados.Total)
				}
				return
			}
			pedido := decodificar[pedidoJSON](t, respuesta)
			if pedido.Estado != caso.estado || pedido.TotalMXN != "0.00" || len(pedido.SKUsRechazados) != 1 {
				t.Errorf("pedido inesperado: %+v", pedido)
			}
			if guardados.Total != 1 {
				t.Errorf("el pedido rechazado debía guardarse igual, hay %d", guardados.Total)
			}
		})
	}
}

func TestCrearPedidoInvalido(t *testing.T) {
	cuerpos := map[string]string{
		"no es JSON":       `lineas=1`,
		"sin líneas":       `{"lineas":[]}`,
		"sin campo lineas": `{}`,
		"cantidad cero":    `{"lineas":[{"sku":"TNG-0001","cantidad":0}]}`,
		"cantidad texto":   `{"lineas":[{"sku":"TNG-0001","cantidad":"dos"}]}`,
		"sku con barra":    `{"lineas":[{"sku":"../salud","cantidad":1}]}`,
		"sku repetido":     `{"lineas":[{"sku":"TNG-0001","cantidad":1},{"sku":"TNG-0001","cantidad":1}]}`,
		"cuerpo enorme":    `{"lineas":[{"sku":"` + strings.Repeat("A", 70_000) + `","cantidad":1}]}`,
	}
	for nombre, cuerpo := range cuerpos {
		s := nuevoServicio()
		respuesta := s.pedir(http.MethodPost, "/pedidos", cuerpo)
		if respuesta.Code != http.StatusBadRequest {
			t.Errorf("%s: código = %d, esperaba 400", nombre, respuesta.Code)
		}
		fallo := decodificar[struct {
			Error string `json:"error"`
		}](t, respuesta)
		if fallo.Error != "pedido_invalido" {
			t.Errorf("%s: error = %q", nombre, fallo.Error)
		}
	}
}

func TestObtenerYListar(t *testing.T) {
	s := nuevoServicio()
	s.pedir(http.MethodPost, "/pedidos", `{"lineas":[{"sku":"TNG-0001","cantidad":1}]}`)
	s.pedir(http.MethodPost, "/pedidos", `{"lineas":[{"sku":"TNG-0005","cantidad":1}]}`)

	respuesta := s.pedir(http.MethodGet, "/pedidos/PED-000002", "")
	if pedido := decodificar[pedidoJSON](t, respuesta); respuesta.Code != http.StatusOK || pedido.Estado != "rechazado_sin_stock" {
		t.Errorf("GET /pedidos/PED-000002 = %d %+v", respuesta.Code, pedido)
	}
	if respuesta := s.pedir(http.MethodGet, "/pedidos/PED-000099", ""); respuesta.Code != http.StatusNotFound {
		t.Errorf("un id inexistente debía dar 404, dio %d", respuesta.Code)
	}

	type lista struct {
		Total   int          `json:"total"`
		Pedidos []pedidoJSON `json:"pedidos"`
	}
	if todos := decodificar[lista](t, s.pedir(http.MethodGet, "/pedidos", "")); todos.Total != 2 || len(todos.Pedidos) != 2 {
		t.Errorf("lista completa = %+v", todos)
	}
	confirmados := decodificar[lista](t, s.pedir(http.MethodGet, "/pedidos?estado=confirmado", ""))
	if confirmados.Total != 1 || confirmados.Pedidos[0].ID != "PED-000001" {
		t.Errorf("lista de confirmados = %+v", confirmados)
	}
	respuesta = s.pedir(http.MethodGet, "/pedidos?estado=inventado", "")
	if !strings.Contains(respuesta.Body.String(), `"pedidos":[]`) {
		t.Errorf("un estado desconocido debía dar lista vacía: %s", respuesta.Body.String())
	}
}

// La regla dura: route es la plantilla, nunca el id real.
func TestLaRutaEsLaPlantillaYNoElIdReal(t *testing.T) {
	s := nuevoServicio()
	s.pedir(http.MethodPost, "/pedidos", `{"lineas":[{"sku":"TNG-0001","cantidad":1}]}`)

	s.pedir(http.MethodGet, "/pedidos/PED-000001", "")
	s.pedir(http.MethodGet, "/pedidos/PED-000001", "")
	s.pedir(http.MethodGet, "/pedidos/PED-000777", "")

	if contadas := s.conteo("GET", "/pedidos/{id}", "200"); contadas != 2 {
		t.Errorf(`route="/pedidos/{id}", status="200" = %v, esperaba 2`, contadas)
	}
	if contadas := s.conteo("GET", "/pedidos/{id}", "404"); contadas != 1 {
		t.Errorf(`route="/pedidos/{id}", status="404" = %v, esperaba 1`, contadas)
	}
	if contadas := s.conteo("POST", "/pedidos", "201"); contadas != 1 {
		t.Errorf(`route="/pedidos", status="201" = %v, esperaba 1`, contadas)
	}

	familias, err := s.metricas.Registro().Gather()
	if err != nil {
		t.Fatal(err)
	}
	for _, familia := range familias {
		for _, metrica := range familia.GetMetric() {
			for _, etiqueta := range metrica.GetLabel() {
				if strings.Contains(etiqueta.GetValue(), "PED-") {
					t.Errorf("%s lleva el id real en %s=%q", familia.GetName(), etiqueta.GetName(), etiqueta.GetValue())
				}
			}
		}
	}
	for _, linea := range s.lineasDeLog(t) {
		if ruta, _ := linea["route"].(string); strings.Contains(ruta, "PED-") {
			t.Errorf("el log lleva el id real en route=%q", ruta)
		}
	}
}

func TestRutaDesconocidaYMetodoNoEstandar(t *testing.T) {
	s := nuevoServicio()

	if respuesta := s.pedir(http.MethodGet, "/no-existe/abc123", ""); respuesta.Code != http.StatusNotFound {
		t.Errorf("código = %d", respuesta.Code)
	}
	s.pedir(http.MethodGet, "/otra/ruta/distinta", "")
	if respuesta := s.pedir("FOO1", "/pedidos", ""); respuesta.Code != http.StatusMethodNotAllowed {
		t.Errorf("código = %d", respuesta.Code)
	}
	s.pedir("BARXYZ", "/pedidos", "")

	if contadas := s.conteo("GET", api.RutaDesconocida, "404"); contadas != 2 {
		t.Errorf(`route="unmatched" = %v, esperaba 2`, contadas)
	}
	if contadas := s.conteo(api.MetodoOtro, api.RutaDesconocida, "405"); contadas != 2 {
		t.Errorf(`method="OTHER" = %v, esperaba 2`, contadas)
	}
	if series := testutil.CollectAndCount(s.metricas.PeticionesServidor); series != 2 {
		t.Errorf("series de http_server_requests_total = %d, esperaba 2", series)
	}
}

func TestSaludYMetricsQuedanFueraDeMetricasYLogs(t *testing.T) {
	s := nuevoServicio()

	if respuesta := s.pedir(http.MethodGet, "/salud", ""); respuesta.Code != http.StatusOK {
		t.Errorf("/salud = %d", respuesta.Code)
	}
	exposicion := s.pedir(http.MethodGet, "/metrics", "")
	if exposicion.Code != http.StatusOK {
		t.Errorf("/metrics = %d", exposicion.Code)
	}

	if series := testutil.CollectAndCount(s.metricas.PeticionesServidor); series != 0 {
		t.Errorf("series de http_server_requests_total = %d, esperaba 0", series)
	}
	if series := testutil.CollectAndCount(s.metricas.DuracionServidor); series != 0 {
		t.Errorf("series de http_server_request_duration_seconds = %d, esperaba 0", series)
	}
	if s.logs.Len() != 0 {
		t.Errorf("no debía haber logs: %s", s.logs.String())
	}
	for _, nombre := range []string{"go_goroutines", "process_cpu_seconds_total", "orders_created_total", "http_server_requests_in_flight"} {
		if !strings.Contains(exposicion.Body.String(), nombre) {
			t.Errorf("/metrics no expone %s", nombre)
		}
	}
}

func TestLogs(t *testing.T) {
	s := nuevoServicio()
	s.pedir(http.MethodPost, "/pedidos", `{"lineas":[{"sku":"TNG-0002","cantidad":3}]}`)
	s.pedir(http.MethodGet, "/pedidos/PED-000404", "")
	s.catalogo.caido = true
	s.pedir(http.MethodPost, "/pedidos", `{"lineas":[{"sku":"TNG-0001","cantidad":1}]}`)

	lineas := s.lineasDeLog(t)
	if len(lineas) != 5 {
		t.Fatalf("líneas de log = %d, esperaba 5: %s", len(lineas), s.logs.String())
	}

	creado := lineas[0]
	if creado["msg"] != "pedido creado" || creado["order_id"] != "PED-000001" || creado["result"] != "confirmed" ||
		creado["lines"] != float64(1) || creado["total_mxn"] != "99.99" || creado["service"] != "pedidos" {
		t.Errorf("línea de pedido creado inesperada: %v", creado)
	}

	peticion := lineas[1]
	for _, campo := range []string{"time", "level", "service", "method", "route", "status", "duration_ms", "msg"} {
		if _, existe := peticion[campo]; !existe {
			t.Errorf("a la línea de petición le falta %s: %v", campo, peticion)
		}
	}
	if peticion["level"] != "info" || peticion["method"] != "POST" || peticion["route"] != "/pedidos" || peticion["status"] != float64(201) {
		t.Errorf("línea de petición inesperada: %v", peticion)
	}

	if noEncontrado := lineas[2]; noEncontrado["level"] != "warning" || noEncontrado["route"] != "/pedidos/{id}" || noEncontrado["status"] != float64(404) {
		t.Errorf("línea del 404 inesperada: %v", noEncontrado)
	}
	if noCreado := lineas[3]; noCreado["level"] != "error" || noCreado["result"] != "dependency_error" {
		t.Errorf("línea de pedido no creado inesperada: %v", noCreado)
	}
	if caido := lineas[4]; caido["level"] != "error" || caido["status"] != float64(503) {
		t.Errorf("línea del 503 inesperada: %v", caido)
	}
}

func TestUnPanicSeCuentaComo500(t *testing.T) {
	m := metricas.Nuevas()
	logs := &bytes.Buffer{}
	logger := api.NuevoLogger(logs)
	mux := http.NewServeMux()
	mux.HandleFunc("GET /explota/{id}", func(http.ResponseWriter, *http.Request) { panic("falla de prueba") })
	manejador := api.Encadenar(mux, api.MiddlewareDeLogs(logger), api.MiddlewareDeMetricas(m, func() bool { return false }), api.MiddlewareDeRecuperacion(logger))

	respuesta := httptest.NewRecorder()
	manejador.ServeHTTP(respuesta, httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/explota/7", http.NoBody))

	if respuesta.Code != http.StatusInternalServerError {
		t.Errorf("código = %d", respuesta.Code)
	}
	if contadas := testutil.ToFloat64(m.PeticionesServidor.WithLabelValues("GET", "/explota/{id}", "500")); contadas != 1 {
		t.Errorf("el panic no quedó contado como 500")
	}
	if enCurso := testutil.ToFloat64(m.EnCurso); enCurso != 0 {
		t.Errorf("http_server_requests_in_flight = %v tras el panic", enCurso)
	}
}
