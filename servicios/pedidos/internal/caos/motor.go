package caos

import (
	"context"
	"runtime/debug"
	"time"
)

const (
	mib = 1024 * 1024
	// tamanoDePagina es cada cuántos bytes se escribe uno para que el bloque ocupe memoria real.
	tamanoDePagina = 4096
)

// Fuga es memoria que se retiene sin liberarla: la falla memoria. No se puede usar desde
// varias goroutines; solo la toca el Motor.
type Fuga struct {
	bloques   [][]byte
	retenido  int
	pendiente float64
}

// Retenido devuelve los bytes retenidos hasta ahora.
func (f *Fuga) Retenido() int {
	return f.retenido
}

// Retener retiene lo que corresponde a ese lapso.
func (f *Fuga) Retener(mbPorMinuto int, lapso time.Duration) {
	f.pendiente += float64(mbPorMinuto) * mib * lapso.Minutes()
	cantidad := int(f.pendiente)
	if cantidad <= 0 {
		return
	}
	f.pendiente -= float64(cantidad)
	bloque := make([]byte, cantidad)
	// Sin escribir en cada página, el sistema no llega a respaldar el bloque con memoria real.
	for i := 0; i < cantidad; i += tamanoDePagina {
		bloque[i] = 1
	}
	f.bloques = append(f.bloques, bloque)
	f.retenido += cantidad
}

// Soltar libera todo lo retenido y se lo devuelve al sistema.
func (f *Fuga) Soltar() {
	f.pendiente = 0
	if f.retenido == 0 {
		return
	}
	f.bloques = nil
	f.retenido = 0
	debug.FreeOSMemory()
}

// Motor es lo que el caos hace con el paso del tiempo: vencer fallas y hacer crecer la fuga.
type Motor struct {
	estado *Estado
	fuga   *Fuga
}

// NuevoMotor crea el motor de un estado.
func NuevoMotor(estado *Estado, fuga *Fuga) *Motor {
	return &Motor{estado: estado, fuga: fuga}
}

// Avanzar hace lo que toca después de que pasó ese lapso.
func (m *Motor) Avanzar(lapso time.Duration) {
	m.estado.Barrer()
	falla, vigente := m.estado.Vigente(Memoria)
	if !vigente {
		m.fuga.Soltar()
		return
	}
	m.fuga.Retener(falla.Enteros[ParamMBPorMinuto], lapso)
}

// Correr avanza una vez por paso hasta que se cancele el contexto.
func (m *Motor) Correr(ctx context.Context, paso time.Duration) {
	reloj := time.NewTicker(paso)
	defer reloj.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-reloj.C:
			m.Avanzar(paso)
		}
	}
}
