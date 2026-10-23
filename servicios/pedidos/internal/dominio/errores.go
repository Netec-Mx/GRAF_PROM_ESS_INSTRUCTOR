// Package dominio contiene las reglas de negocio de los pedidos.
// No conoce HTTP ni Prometheus.
package dominio

import "errors"

var (
	// ErrPedidoInvalido indica que la solicitud de pedido no cumple las reglas.
	ErrPedidoInvalido = errors.New("pedido inválido")
	// ErrPedidoNoEncontrado indica que no existe un pedido con ese id.
	ErrPedidoNoEncontrado = errors.New("pedido no encontrado")
	// ErrMontoInvalido indica que un texto no es un monto con dos decimales.
	ErrMontoInvalido = errors.New("monto inválido")
)
