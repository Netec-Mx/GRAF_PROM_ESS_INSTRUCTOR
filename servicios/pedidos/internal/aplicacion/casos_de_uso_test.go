package aplicacion_test

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/RodrigoMSB/graf-prom-ess/servicios/pedidos/internal/aplicacion"
	"github.com/RodrigoMSB/graf-prom-ess/servicios/pedidos/internal/dominio"
)

// catalogoFalso es un CatalogoPort de mentira: responde desde un mapa o con el error indicado.
type catalogoFalso struct {
	productos map[string]aplicacion.Producto
	err       error
	consultas []string
}

func (c *catalogoFalso) ObtenerProducto(_ context.Context, sku string) (aplicacion.Producto, error) {
	c.consultas = append(c.consultas, sku)
	if c.err != nil {
		return aplicacion.Producto{}, c.err
	}
	producto, existe := c.productos[sku]
	if !existe {
		return aplicacion.Producto{}, aplicacion.ErrProductoNoExiste
	}
	return producto, nil
}

type repositorioFalso struct {
	guardados []dominio.Pedido
}

func (r *repositorioFalso) Guardar(pedido dominio.Pedido) dominio.Pedido {
	pedido.ID = fmt.Sprintf("PED-%06d", len(r.guardados)+1)
	r.guardados = append(r.guardados, pedido)
	return pedido
}

func (r *repositorioFalso) Obtener(id string) (dominio.Pedido, error) {
	for _, pedido := range r.guardados {
		if pedido.ID == id {
			return pedido, nil
		}
	}
	return dominio.Pedido{}, dominio.ErrPedidoNoEncontrado
}

func (r *repositorioFalso) Listar(estado dominio.Estado) []dominio.Pedido {
	var salida []dominio.Pedido
	for _, pedido := range r.guardados {
		if estado == "" || pedido.Estado == estado {
			salida = append(salida, pedido)
		}
	}
	return salida
}

type observadorFalso struct {
	intentos []aplicacion.Resultado
	lineas   []int
}

func (o *observadorFalso) IntentoDeCreacion(resultado aplicacion.Resultado) {
	o.intentos = append(o.intentos, resultado)
}

func (o *observadorFalso) PedidoGuardado(lineas int) {
	o.lineas = append(o.lineas, lineas)
}

func productosDePrueba() map[string]aplicacion.Producto {
	return map[string]aplicacion.Producto{
		"TNG-0001": {SKU: "TNG-0001", Nombre: "Aguacate Hass (kg)", Precio: 8900, Stock: 40},
		"TNG-0002": {SKU: "TNG-0002", Nombre: "Jitomate saladet (kg)", Precio: 3333, Stock: 10},
		"TNG-0005": {SKU: "TNG-0005", Nombre: "Mango ataulfo (kg)", Precio: 5400, Stock: 0},
	}
}

type escenario struct {
	catalogo    *catalogoFalso
	repositorio *repositorioFalso
	observador  *observadorFalso
	pedidos     *aplicacion.Pedidos
}

func nuevoEscenario(errDelCatalogo error) escenario {
	e := escenario{
		catalogo:    &catalogoFalso{productos: productosDePrueba(), err: errDelCatalogo},
		repositorio: &repositorioFalso{},
		observador:  &observadorFalso{},
	}
	reloj := func() time.Time { return time.Date(2026, 10, 11, 12, 0, 0, 0, time.UTC) }
	e.pedidos = aplicacion.NuevosPedidos(e.catalogo, e.repositorio, e.observador, reloj)
	return e
}

func TestCrearCubreLosCuatroResultados(t *testing.T) {
	casos := []struct {
		nombre          string
		lineas          []dominio.LineaSolicitada
		errDelCatalogo  error
		resultado       aplicacion.Resultado
		estado          dominio.Estado
		total           string
		errEsperado     error
		pedidosGuardado int
	}{
		{
			nombre:          "confirmado",
			lineas:          []dominio.LineaSolicitada{{SKU: "TNG-0001", Cantidad: 2}, {SKU: "TNG-0002", Cantidad: 3}},
			resultado:       aplicacion.ResultadoConfirmado,
			estado:          dominio.EstadoConfirmado,
			total:           "277.99",
			pedidosGuardado: 1,
		},
		{
			nombre:          "sku inexistente",
			lineas:          []dominio.LineaSolicitada{{SKU: "TNG-0001", Cantidad: 1}, {SKU: "TNG-9999", Cantidad: 1}},
			resultado:       aplicacion.ResultadoSKUInexistente,
			estado:          dominio.EstadoRechazadoSKUInexistente,
			total:           "0.00",
			pedidosGuardado: 1,
		},
		{
			nombre:          "sin stock",
			lineas:          []dominio.LineaSolicitada{{SKU: "TNG-0002", Cantidad: 11}},
			resultado:       aplicacion.ResultadoSinStock,
			estado:          dominio.EstadoRechazadoSinStock,
			total:           "0.00",
			pedidosGuardado: 1,
		},
		{
			nombre:          "catálogo caído",
			lineas:          []dominio.LineaSolicitada{{SKU: "TNG-0001", Cantidad: 1}},
			errDelCatalogo:  aplicacion.ErrCatalogoNoDisponible,
			resultado:       aplicacion.ResultadoErrorDeDependencia,
			errEsperado:     aplicacion.ErrCatalogoNoDisponible,
			pedidosGuardado: 0,
		},
	}

	for _, caso := range casos {
		t.Run(caso.nombre, func(t *testing.T) {
			e := nuevoEscenario(caso.errDelCatalogo)

			pedido, resultado, err := e.pedidos.Crear(context.Background(), caso.lineas)

			if !errors.Is(err, caso.errEsperado) {
				t.Fatalf("error = %v, esperaba %v", err, caso.errEsperado)
			}
			if resultado != caso.resultado {
				t.Errorf("resultado = %q, esperaba %q", resultado, caso.resultado)
			}
			if len(e.repositorio.guardados) != caso.pedidosGuardado {
				t.Errorf("pedidos guardados = %d, esperaba %d", len(e.repositorio.guardados), caso.pedidosGuardado)
			}
			if len(e.observador.intentos) != 1 || e.observador.intentos[0] != caso.resultado {
				t.Errorf("intentos observados = %v", e.observador.intentos)
			}
			if caso.errEsperado != nil {
				if len(e.observador.lineas) != 0 {
					t.Errorf("no debía observar líneas, observó %v", e.observador.lineas)
				}
				return
			}
			if pedido.Estado != caso.estado || pedido.Total.Texto() != caso.total || pedido.ID != "PED-000001" {
				t.Errorf("pedido inesperado: %+v", pedido)
			}
			if len(e.observador.lineas) != 1 || e.observador.lineas[0] != len(caso.lineas) {
				t.Errorf("líneas observadas = %v", e.observador.lineas)
			}
		})
	}
}

func TestCrearTrataCualquierErrorDelCatalogoComoDependenciaCaida(t *testing.T) {
	e := nuevoEscenario(errors.New("connection refused"))

	_, resultado, err := e.pedidos.Crear(context.Background(), []dominio.LineaSolicitada{{SKU: "TNG-0001", Cantidad: 1}})

	if !errors.Is(err, aplicacion.ErrCatalogoNoDisponible) || resultado != aplicacion.ResultadoErrorDeDependencia {
		t.Errorf("resultado = %q, error = %v", resultado, err)
	}
}

func TestCrearConSolicitudInvalidaNoConsultaNiCuenta(t *testing.T) {
	e := nuevoEscenario(nil)

	_, resultado, err := e.pedidos.Crear(context.Background(), []dominio.LineaSolicitada{{SKU: "TNG-0001", Cantidad: 0}})

	if !errors.Is(err, dominio.ErrPedidoInvalido) || resultado != "" {
		t.Errorf("resultado = %q, error = %v", resultado, err)
	}
	if len(e.catalogo.consultas) != 0 || len(e.repositorio.guardados) != 0 || len(e.observador.intentos) != 0 {
		t.Errorf("una solicitud inválida no debe consultar, guardar ni contar")
	}
}

func TestCrearConsultaUnaVezPorLinea(t *testing.T) {
	e := nuevoEscenario(nil)

	_, _, err := e.pedidos.Crear(context.Background(), []dominio.LineaSolicitada{
		{SKU: "TNG-0001", Cantidad: 1}, {SKU: "TNG-9999", Cantidad: 1}, {SKU: "TNG-0002", Cantidad: 1},
	})

	if err != nil {
		t.Fatal(err)
	}
	if len(e.catalogo.consultas) != 3 {
		t.Errorf("consultas al catálogo = %v, esperaba una por línea", e.catalogo.consultas)
	}
}

func TestObtenerYListar(t *testing.T) {
	e := nuevoEscenario(nil)
	ctx := context.Background()
	if _, _, err := e.pedidos.Crear(ctx, []dominio.LineaSolicitada{{SKU: "TNG-0001", Cantidad: 1}}); err != nil {
		t.Fatal(err)
	}
	if _, _, err := e.pedidos.Crear(ctx, []dominio.LineaSolicitada{{SKU: "TNG-0005", Cantidad: 1}}); err != nil {
		t.Fatal(err)
	}

	pedido, err := e.pedidos.Obtener("PED-000002")
	if err != nil || pedido.Estado != dominio.EstadoRechazadoSinStock {
		t.Errorf("Obtener = %+v, %v", pedido, err)
	}
	if _, err := e.pedidos.Obtener("PED-999999"); !errors.Is(err, dominio.ErrPedidoNoEncontrado) {
		t.Errorf("esperaba ErrPedidoNoEncontrado, obtuve %v", err)
	}
	if todos := e.pedidos.Listar(""); len(todos) != 2 {
		t.Errorf("Listar sin filtro = %d pedidos", len(todos))
	}
	if confirmados := e.pedidos.Listar(dominio.EstadoConfirmado); len(confirmados) != 1 {
		t.Errorf("Listar confirmados = %d pedidos", len(confirmados))
	}
}
