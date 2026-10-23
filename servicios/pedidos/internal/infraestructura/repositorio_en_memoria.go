// Package infraestructura contiene los adaptadores de salida de pedidos: el cliente HTTP de
// catalogo y el repositorio en memoria.
package infraestructura

import (
	"fmt"
	"sync"

	"github.com/RodrigoMSB/graf-prom-ess/servicios/pedidos/internal/dominio"
)

// CapacidadPorDefecto es cuántos pedidos conserva el repositorio. Al superarla descarta el más
// antiguo, para que la memoria del servicio no crezca sin límite bajo carga.
const CapacidadPorDefecto = 1000

// RepositorioEnMemoria guarda los pedidos en memoria. Se pierden al reiniciar el servicio.
type RepositorioEnMemoria struct {
	mu        sync.RWMutex
	capacidad int
	siguiente int
	orden     []string
	pedidos   map[string]dominio.Pedido
}

// NuevoRepositorioEnMemoria crea un repositorio vacío que conserva hasta capacidad pedidos.
func NuevoRepositorioEnMemoria(capacidad int) *RepositorioEnMemoria {
	if capacidad < 1 {
		capacidad = CapacidadPorDefecto
	}
	return &RepositorioEnMemoria{
		capacidad: capacidad,
		siguiente: 1,
		pedidos:   make(map[string]dominio.Pedido, capacidad),
	}
}

// Guardar asigna el siguiente id secuencial (PED-000001, PED-000002...) y guarda el pedido.
func (r *RepositorioEnMemoria) Guardar(pedido dominio.Pedido) dominio.Pedido {
	r.mu.Lock()
	defer r.mu.Unlock()

	pedido.ID = fmt.Sprintf("PED-%06d", r.siguiente)
	r.siguiente++

	if len(r.orden) >= r.capacidad {
		delete(r.pedidos, r.orden[0])
		r.orden = r.orden[1:]
	}
	r.orden = append(r.orden, pedido.ID)
	r.pedidos[pedido.ID] = pedido
	return pedido
}

// Obtener devuelve el pedido con ese id, o dominio.ErrPedidoNoEncontrado.
func (r *RepositorioEnMemoria) Obtener(id string) (dominio.Pedido, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	pedido, existe := r.pedidos[id]
	if !existe {
		return dominio.Pedido{}, dominio.ErrPedidoNoEncontrado
	}
	return pedido, nil
}

// Listar devuelve los pedidos del más antiguo al más nuevo. Con estado vacío, todos.
func (r *RepositorioEnMemoria) Listar(estado dominio.Estado) []dominio.Pedido {
	r.mu.RLock()
	defer r.mu.RUnlock()

	salida := make([]dominio.Pedido, 0, len(r.orden))
	for _, id := range r.orden {
		pedido := r.pedidos[id]
		if estado == "" || pedido.Estado == estado {
			salida = append(salida, pedido)
		}
	}
	return salida
}
