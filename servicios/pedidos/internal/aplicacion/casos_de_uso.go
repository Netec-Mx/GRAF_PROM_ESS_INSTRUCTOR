package aplicacion

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/RodrigoMSB/graf-prom-ess/servicios/pedidos/internal/dominio"
)

// Pedidos reúne los casos de uso: crear, obtener y listar.
type Pedidos struct {
	catalogo    CatalogoPort
	repositorio Repositorio
	observador  Observador
	ahora       func() time.Time
}

// NuevosPedidos arma los casos de uso. ahora es el reloj; en producción es time.Now.
func NuevosPedidos(catalogo CatalogoPort, repositorio Repositorio, observador Observador, ahora func() time.Time) *Pedidos {
	return &Pedidos{catalogo: catalogo, repositorio: repositorio, observador: observador, ahora: ahora}
}

// Crear valida la solicitud, consulta cada sku al catálogo y guarda el pedido, confirmado o
// rechazado. Devuelve el pedido guardado y su resultado.
//
// Si la solicitud es inválida devuelve dominio.ErrPedidoInvalido y no cuenta como intento.
// Si el catálogo falla devuelve ErrCatalogoNoDisponible, no guarda nada y el resultado es
// ResultadoErrorDeDependencia.
func (p *Pedidos) Crear(ctx context.Context, solicitadas []dominio.LineaSolicitada) (dominio.Pedido, Resultado, error) {
	if err := dominio.ValidarSolicitud(solicitadas); err != nil {
		return dominio.Pedido{}, "", err
	}

	catalogo := make(map[string]dominio.Disponibilidad, len(solicitadas))
	for _, linea := range solicitadas {
		producto, err := p.catalogo.ObtenerProducto(ctx, linea.SKU)
		switch {
		case err == nil:
			catalogo[linea.SKU] = dominio.Disponibilidad{
				Existe: true, Nombre: producto.Nombre, Precio: producto.Precio, Stock: producto.Stock,
			}
		case errors.Is(err, ErrProductoNoExiste):
			catalogo[linea.SKU] = dominio.Disponibilidad{}
		default:
			p.observador.IntentoDeCreacion(ResultadoErrorDeDependencia)
			if !errors.Is(err, ErrCatalogoNoDisponible) {
				err = fmt.Errorf("%w: %w", ErrCatalogoNoDisponible, err)
			}
			return dominio.Pedido{}, ResultadoErrorDeDependencia, fmt.Errorf("consultando %s: %w", linea.SKU, err)
		}
	}

	pedido := p.repositorio.Guardar(dominio.NuevoPedido(solicitadas, catalogo, p.ahora()))
	resultado := resultadoDe(pedido.Estado)
	p.observador.IntentoDeCreacion(resultado)
	p.observador.PedidoGuardado(len(pedido.Lineas))
	return pedido, resultado, nil
}

// Obtener devuelve un pedido por su id, o dominio.ErrPedidoNoEncontrado.
func (p *Pedidos) Obtener(id string) (dominio.Pedido, error) {
	return p.repositorio.Obtener(id)
}

// Listar devuelve los pedidos guardados. Con estado vacío devuelve todos.
func (p *Pedidos) Listar(estado dominio.Estado) []dominio.Pedido {
	return p.repositorio.Listar(estado)
}

func resultadoDe(estado dominio.Estado) Resultado {
	switch estado {
	case dominio.EstadoConfirmado:
		return ResultadoConfirmado
	case dominio.EstadoRechazadoSKUInexistente:
		return ResultadoSKUInexistente
	case dominio.EstadoRechazadoSinStock:
		return ResultadoSinStock
	default:
		return resultadoDeEstadoDesconocido
	}
}
