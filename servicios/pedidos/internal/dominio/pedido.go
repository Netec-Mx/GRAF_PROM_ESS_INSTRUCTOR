package dominio

import (
	"fmt"
	"time"
)

// Estado es el resultado con el que quedó guardado un pedido.
type Estado string

// Estados posibles de un pedido.
const (
	EstadoConfirmado              Estado = "confirmado"
	EstadoRechazadoSKUInexistente Estado = "rechazado_sku_inexistente"
	EstadoRechazadoSinStock       Estado = "rechazado_sin_stock"
)

// Límites de una solicitud de pedido.
const (
	MaxLineas   = 50
	MaxCantidad = 10000
	MaxLargoSKU = 32
)

// LineaSolicitada es lo que pide el cliente: un sku y cuántas unidades.
type LineaSolicitada struct {
	SKU      string
	Cantidad int
}

// Disponibilidad es lo que el catálogo sabe de un sku al momento de crear el pedido.
type Disponibilidad struct {
	Existe bool
	Nombre string
	Precio Dinero
	Stock  int
}

// Linea es una línea de un pedido ya evaluado. Si el sku no existe en el catálogo,
// ConPrecio es false y Nombre y PrecioUnitario quedan vacíos.
type Linea struct {
	SKU            string
	Cantidad       int
	Nombre         string
	PrecioUnitario Dinero
	ConPrecio      bool
}

// Subtotal es el precio unitario por la cantidad.
func (l Linea) Subtotal() Dinero {
	return l.PrecioUnitario.Por(l.Cantidad)
}

// Pedido es un pedido guardado, confirmado o rechazado.
type Pedido struct {
	ID     string
	Estado Estado
	Lineas []Linea
	// Total es la suma de los subtotales si el pedido quedó confirmado, y cero si fue rechazado.
	Total Dinero
	// SKUsRechazados son los sku que causaron el rechazo. Vacío si quedó confirmado.
	SKUsRechazados []string
	CreadoEn       time.Time
}

// ValidarSolicitud revisa las líneas antes de consultar el catálogo.
func ValidarSolicitud(lineas []LineaSolicitada) error {
	if len(lineas) == 0 {
		return fmt.Errorf("%w: debe traer al menos una línea", ErrPedidoInvalido)
	}
	if len(lineas) > MaxLineas {
		return fmt.Errorf("%w: admite hasta %d líneas", ErrPedidoInvalido, MaxLineas)
	}
	vistos := make(map[string]struct{}, len(lineas))
	for _, linea := range lineas {
		if !skuValido(linea.SKU) {
			return fmt.Errorf("%w: sku con formato incorrecto", ErrPedidoInvalido)
		}
		if linea.Cantidad < 1 || linea.Cantidad > MaxCantidad {
			return fmt.Errorf("%w: la cantidad de %s debe estar entre 1 y %d",
				ErrPedidoInvalido, linea.SKU, MaxCantidad)
		}
		if _, repetido := vistos[linea.SKU]; repetido {
			return fmt.Errorf("%w: el sku %s está repetido", ErrPedidoInvalido, linea.SKU)
		}
		vistos[linea.SKU] = struct{}{}
	}
	return nil
}

// skuValido acepta letras, dígitos y guiones. Así un sku nunca puede alterar la URL con la
// que se consulta el catálogo.
func skuValido(sku string) bool {
	if sku == "" || len(sku) > MaxLargoSKU {
		return false
	}
	for _, c := range sku {
		esLetra := (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z')
		esDigito := c >= '0' && c <= '9'
		if !esLetra && !esDigito && c != '-' {
			return false
		}
	}
	return true
}

// NuevoPedido evalúa las líneas contra lo que respondió el catálogo y decide el estado.
// Un sku inexistente pesa más que la falta de stock. El pedido sale sin ID; lo asigna el
// repositorio al guardarlo.
func NuevoPedido(solicitadas []LineaSolicitada, catalogo map[string]Disponibilidad, ahora time.Time) Pedido {
	lineas := make([]Linea, 0, len(solicitadas))
	var inexistentes, sinStock []string
	var total Dinero

	for _, solicitada := range solicitadas {
		linea := Linea{SKU: solicitada.SKU, Cantidad: solicitada.Cantidad}
		producto := catalogo[solicitada.SKU]
		if !producto.Existe {
			inexistentes = append(inexistentes, solicitada.SKU)
			lineas = append(lineas, linea)
			continue
		}
		linea.Nombre = producto.Nombre
		linea.PrecioUnitario = producto.Precio
		linea.ConPrecio = true
		if solicitada.Cantidad > producto.Stock {
			sinStock = append(sinStock, solicitada.SKU)
		}
		total += linea.Subtotal()
		lineas = append(lineas, linea)
	}

	pedido := Pedido{Lineas: lineas, CreadoEn: ahora}
	switch {
	case len(inexistentes) > 0:
		pedido.Estado = EstadoRechazadoSKUInexistente
		pedido.SKUsRechazados = inexistentes
	case len(sinStock) > 0:
		pedido.Estado = EstadoRechazadoSinStock
		pedido.SKUsRechazados = sinStock
	default:
		pedido.Estado = EstadoConfirmado
		pedido.Total = total
	}
	return pedido
}
