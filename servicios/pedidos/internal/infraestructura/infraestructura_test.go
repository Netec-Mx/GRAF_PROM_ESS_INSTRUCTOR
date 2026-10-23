package infraestructura_test

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/prometheus/client_golang/prometheus/testutil"

	"github.com/RodrigoMSB/graf-prom-ess/servicios/pedidos/internal/aplicacion"
	"github.com/RodrigoMSB/graf-prom-ess/servicios/pedidos/internal/dominio"
	"github.com/RodrigoMSB/graf-prom-ess/servicios/pedidos/internal/infraestructura"
	"github.com/RodrigoMSB/graf-prom-ess/servicios/pedidos/internal/metricas"
)

// catalogoDePrueba imita las respuestas del servicio catalogo real.
func catalogoDePrueba(t *testing.T) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("GET /productos/{sku}", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.PathValue("sku") {
		case "TNG-0001":
			_, _ = w.Write([]byte(`{"sku":"TNG-0001","nombre":"Aguacate Hass (kg)","categoria":"frutas-y-verduras","precio_mxn":"89.00","stock":40}`))
		case "TNG-0500":
			w.WriteHeader(http.StatusInternalServerError)
		case "TNG-0600":
			_, _ = w.Write([]byte(`esto no es json`))
		case "TNG-0700":
			_, _ = w.Write([]byte(`{"sku":"TNG-0700","nombre":"Precio como número","precio_mxn":89.0,"stock":1}`))
		case "TNG-0800":
			_, _ = w.Write([]byte(`{"sku":"TNG-0001","nombre":"Otro producto","precio_mxn":"89.00","stock":1}`))
		case "TNG-0900":
			time.Sleep(300 * time.Millisecond)
			_, _ = w.Write([]byte(`{"sku":"TNG-0900","nombre":"Lento","precio_mxn":"1.00","stock":1}`))
		default:
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"error":"producto_no_encontrado","mensaje":"No existe"}`))
		}
	})
	servidor := httptest.NewServer(mux)
	t.Cleanup(servidor.Close)
	return servidor
}

func TestClienteCatalogo(t *testing.T) {
	servidor := catalogoDePrueba(t)
	m := metricas.Nuevas()
	cliente, err := infraestructura.NuevoClienteCatalogo(servidor.URL, 100*time.Millisecond, m)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()

	producto, err := cliente.ObtenerProducto(ctx, "TNG-0001")
	if err != nil {
		t.Fatalf("producto existente: %v", err)
	}
	esperado := aplicacion.Producto{SKU: "TNG-0001", Nombre: "Aguacate Hass (kg)", Precio: 8900, Stock: 40}
	if producto != esperado {
		t.Errorf("producto = %+v, esperaba %+v", producto, esperado)
	}

	if _, err := cliente.ObtenerProducto(ctx, "TNG-9999"); !errors.Is(err, aplicacion.ErrProductoNoExiste) {
		t.Errorf("sku inexistente: esperaba ErrProductoNoExiste, obtuve %v", err)
	}

	caidos := map[string]string{
		"TNG-0500": "respuesta 500",
		"TNG-0600": "cuerpo que no es JSON",
		"TNG-0700": "precio como número y no como texto",
		"TNG-0800": "sku distinto al pedido",
		"TNG-0900": "respuesta más lenta que el timeout",
	}
	for sku, motivo := range caidos {
		if _, err := cliente.ObtenerProducto(ctx, sku); !errors.Is(err, aplicacion.ErrCatalogoNoDisponible) {
			t.Errorf("%s: esperaba ErrCatalogoNoDisponible, obtuve %v", motivo, err)
		}
	}

	conteos := map[string]float64{"200": 4, "404": 1, "500": 1, metricas.EstadoSinRespuesta: 1}
	for estado, esperado := range conteos {
		obtenido := testutil.ToFloat64(m.PeticionesCliente.WithLabelValues(metricas.PeerCatalogo, estado))
		if obtenido != esperado {
			t.Errorf(`http_client_requests_total{status=%q} = %v, esperaba %v`, estado, obtenido, esperado)
		}
	}
}

func TestClienteCatalogoSinNadieEscuchando(t *testing.T) {
	servidor := catalogoDePrueba(t)
	urlBase := servidor.URL
	servidor.Close()

	m := metricas.Nuevas()
	cliente, err := infraestructura.NuevoClienteCatalogo(urlBase, time.Second, m)
	if err != nil {
		t.Fatal(err)
	}

	if _, err := cliente.ObtenerProducto(context.Background(), "TNG-0001"); !errors.Is(err, aplicacion.ErrCatalogoNoDisponible) {
		t.Errorf("esperaba ErrCatalogoNoDisponible, obtuve %v", err)
	}
	sinRespuesta := testutil.ToFloat64(m.PeticionesCliente.WithLabelValues(metricas.PeerCatalogo, metricas.EstadoSinRespuesta))
	if sinRespuesta != 1 {
		t.Errorf(`http_client_requests_total{status="error"} = %v, esperaba 1`, sinRespuesta)
	}
}

func TestNuevoClienteCatalogoRechazaUnaURLInvalida(t *testing.T) {
	for _, urlBase := range []string{"", "catalogo:8000", "ftp://catalogo", "http://", "://x"} {
		if _, err := infraestructura.NuevoClienteCatalogo(urlBase, time.Second, metricas.Nuevas()); err == nil {
			t.Errorf("NuevoClienteCatalogo(%q) debía fallar", urlBase)
		}
	}
}

func TestRepositorioAsignaIdsSecuenciales(t *testing.T) {
	repositorio := infraestructura.NuevoRepositorioEnMemoria(10)

	primero := repositorio.Guardar(dominio.Pedido{Estado: dominio.EstadoConfirmado})
	segundo := repositorio.Guardar(dominio.Pedido{Estado: dominio.EstadoRechazadoSinStock})

	if primero.ID != "PED-000001" || segundo.ID != "PED-000002" {
		t.Errorf("ids = %s y %s", primero.ID, segundo.ID)
	}
	if obtenido, err := repositorio.Obtener("PED-000002"); err != nil || obtenido.Estado != dominio.EstadoRechazadoSinStock {
		t.Errorf("Obtener = %+v, %v", obtenido, err)
	}
	if _, err := repositorio.Obtener("PED-000003"); !errors.Is(err, dominio.ErrPedidoNoEncontrado) {
		t.Errorf("esperaba ErrPedidoNoEncontrado, obtuve %v", err)
	}
	if todos := repositorio.Listar(""); len(todos) != 2 || todos[0].ID != "PED-000001" {
		t.Errorf("Listar = %+v", todos)
	}
	if rechazados := repositorio.Listar(dominio.EstadoRechazadoSinStock); len(rechazados) != 1 {
		t.Errorf("Listar por estado = %+v", rechazados)
	}
	if vacio := repositorio.Listar("no-existe"); len(vacio) != 0 {
		t.Errorf("un estado desconocido debía dar lista vacía, dio %+v", vacio)
	}
}

func TestRepositorioDescartaElMasAntiguoAlLlenarse(t *testing.T) {
	repositorio := infraestructura.NuevoRepositorioEnMemoria(3)
	for range 5 {
		repositorio.Guardar(dominio.Pedido{Estado: dominio.EstadoConfirmado})
	}

	todos := repositorio.Listar("")
	if len(todos) != 3 || todos[0].ID != "PED-000003" || todos[2].ID != "PED-000005" {
		t.Errorf("Listar = %+v", todos)
	}
	if _, err := repositorio.Obtener("PED-000001"); !errors.Is(err, dominio.ErrPedidoNoEncontrado) {
		t.Errorf("el pedido más antiguo debía haberse descartado, obtuve %v", err)
	}
}

func TestRepositorioConcurrente(t *testing.T) {
	const escritores, porEscritor = 8, 50
	repositorio := infraestructura.NuevoRepositorioEnMemoria(escritores * porEscritor)

	var espera sync.WaitGroup
	for range escritores {
		espera.Go(func() {
			for range porEscritor {
				guardado := repositorio.Guardar(dominio.Pedido{Estado: dominio.EstadoConfirmado})
				if _, err := repositorio.Obtener(guardado.ID); err != nil {
					t.Errorf("no encontré %s recién guardado", guardado.ID)
				}
				repositorio.Listar("")
			}
		})
	}
	espera.Wait()

	todos := repositorio.Listar("")
	if len(todos) != escritores*porEscritor {
		t.Fatalf("pedidos = %d, esperaba %d", len(todos), escritores*porEscritor)
	}
	for i, pedido := range todos {
		if esperado := fmt.Sprintf("PED-%06d", i+1); pedido.ID != esperado {
			t.Fatalf("posición %d: id %s, esperaba %s", i, pedido.ID, esperado)
		}
	}
}
