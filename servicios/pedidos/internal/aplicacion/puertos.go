// Package aplicacion contiene los casos de uso de pedidos y los puertos que necesitan.
// No conoce HTTP ni Prometheus.
package aplicacion

import (
	"context"
	"errors"

	"github.com/RodrigoMSB/graf-prom-ess/servicios/pedidos/internal/dominio"
)

var (
	// ErrProductoNoExiste lo devuelve CatalogoPort cuando el catálogo no conoce el sku.
	ErrProductoNoExiste = errors.New("el producto no existe en el catálogo")
	// ErrCatalogoNoDisponible indica que el catálogo no respondió o respondió con un error.
	ErrCatalogoNoDisponible = errors.New("el catálogo no está disponible")
)

// Producto es lo que pedidos necesita saber de un producto del catálogo.
type Producto struct {
	SKU    string
	Nombre string
	Precio dominio.Dinero
	Stock  int
}

// CatalogoPort es la consulta al servicio catalogo que consumen los casos de uso.
// Devuelve ErrProductoNoExiste si el sku no existe y ErrCatalogoNoDisponible ante
// cualquier otra falla.
type CatalogoPort interface {
	ObtenerProducto(ctx context.Context, sku string) (Producto, error)
}

// Repositorio guarda y recupera pedidos.
type Repositorio interface {
	// Guardar asigna el id al pedido, lo guarda y lo devuelve con el id puesto.
	Guardar(pedido dominio.Pedido) dominio.Pedido
	// Obtener devuelve dominio.ErrPedidoNoEncontrado si no existe.
	Obtener(id string) (dominio.Pedido, error)
	// Listar devuelve los pedidos del más antiguo al más nuevo. Con estado vacío, todos.
	Listar(estado dominio.Estado) []dominio.Pedido
}

// Resultado es el desenlace de un intento de crear un pedido.
type Resultado string

// Resultados posibles. Son también los valores de la etiqueta result de orders_created_total.
const (
	ResultadoConfirmado          Resultado = "confirmed"
	ResultadoSKUInexistente      Resultado = "rejected_unknown_sku"
	ResultadoSinStock            Resultado = "rejected_out_of_stock"
	ResultadoErrorDeDependencia  Resultado = "dependency_error"
	resultadoDeEstadoDesconocido Resultado = "unknown"
)

// Observador recibe los hechos de negocio que luego se publican como métricas.
type Observador interface {
	// IntentoDeCreacion se llama una vez por cada intento, con su resultado.
	IntentoDeCreacion(resultado Resultado)
	// PedidoGuardado se llama cuando un pedido queda guardado, con su número de líneas.
	PedidoGuardado(lineas int)
}
