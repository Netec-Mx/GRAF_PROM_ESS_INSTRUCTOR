// Package caos guarda las fallas de caos encendidas en el servicio.
//
// El estado vive solo en memoria: un reinicio del proceso apaga todas las fallas. Dominio y
// aplicacion no conocen este paquete.
package caos

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Tipos de falla del servicio.
const (
	Latencia     = "latencia"
	Errores      = "errores"
	Cardinalidad = "cardinalidad"
	Memoria      = "memoria"
)

// Nombres de los parámetros.
const (
	ParamMs          = "ms"
	ParamJitterMs    = "jitter_ms"
	ParamPorcentaje  = "porcentaje"
	ParamStatus      = "status"
	ParamMBPorMinuto = "mb_por_minuto"
	paramRuta        = "ruta"
	paramDuracion    = "duracion_s"
)

// ErrFallaDesconocida indica que el tipo de falla no existe en este servicio.
var ErrFallaDesconocida = errors.New("falla desconocida")

// ErrParametrosInvalidos indica que el cuerpo no cumple el contrato del tipo de falla. El
// mensaje del error dice qué parámetro falló.
var ErrParametrosInvalidos = errors.New("parámetros inválidos")

// Tipos devuelve todas las fallas del servicio, en el orden en que se muestran.
func Tipos() []string {
	return []string{Latencia, Errores, Cardinalidad, Memoria}
}

// entero es el rango de un parámetro entero.
type entero struct {
	nombre      string
	minimo      int
	maximo      int
	obligatorio bool
	porDefecto  int
}

var (
	porcentaje = entero{nombre: ParamPorcentaje, minimo: 1, maximo: 100, porDefecto: 100}
	duracion   = entero{nombre: paramDuracion, minimo: 1, maximo: 86400}
)

func estadosDeError() []int {
	return []int{500, 502, 503, 504}
}

// enterosDe devuelve los parámetros enteros de un tipo de falla.
func enterosDe(tipo string) []entero {
	switch tipo {
	case Latencia:
		return []entero{
			{nombre: ParamMs, minimo: 1, maximo: 10000, obligatorio: true},
			{nombre: ParamJitterMs, minimo: 0, maximo: 5000},
			porcentaje,
		}
	case Errores:
		return []entero{porcentaje}
	case Memoria:
		return []entero{{nombre: ParamMBPorMinuto, minimo: 1, maximo: 200, obligatorio: true}}
	default:
		return nil
	}
}

// admiteRuta dice si la falla se puede limitar a una sola ruta.
func admiteRuta(tipo string) bool {
	return tipo == Latencia || tipo == Errores
}

// Falla es una falla encendida.
type Falla struct {
	Tipo    string
	Enteros map[string]int
	// Ruta es la plantilla a la que se limita la falla. Vacía, alcanza a todas las de negocio.
	Ruta string
	// Vence es cuándo se apaga sola. El valor cero significa que no vence.
	Vence time.Time
}

// AplicaA dice si la falla alcanza a esa plantilla de ruta.
func (f Falla) AplicaA(ruta string) bool {
	return f.Ruta == "" || f.Ruta == ruta
}

func (f Falla) parametros() map[string]any {
	parametros := make(map[string]any, len(f.Enteros)+1)
	for nombre, valor := range f.Enteros {
		parametros[nombre] = valor
	}
	if f.Ruta != "" {
		parametros[paramRuta] = f.Ruta
	}
	return parametros
}

// Descripcion es el estado de una falla tal como sale en GET /caos.
type Descripcion struct {
	Tipo       string         `json:"tipo"`
	Activa     bool           `json:"activa"`
	RestanteS  *int           `json:"restante_s"`
	Parametros map[string]any `json:"parametros"`
}

// Estado dice qué fallas están encendidas. Se puede usar desde varias goroutines.
type Estado struct {
	rutas  []string
	reloj  func() time.Time
	logger *slog.Logger

	candado sync.RWMutex
	fallas  map[string]Falla
}

// NuevoEstado crea el estado, con todo apagado. rutas son las plantillas de negocio que el
// parámetro ruta acepta. El reloj se inyecta para probar duracion_s sin esperar.
func NuevoEstado(rutas []string, reloj func() time.Time, logger *slog.Logger) *Estado {
	return &Estado{rutas: rutas, reloj: reloj, logger: logger, fallas: map[string]Falla{}}
}

// Activar enciende una falla, o reemplaza la que había de ese tipo, con el cuerpo JSON dado.
func (e *Estado) Activar(tipo string, cuerpo []byte) (Falla, error) {
	falla, segundos, err := e.validar(tipo, cuerpo)
	if err != nil {
		return Falla{}, err
	}
	if segundos > 0 {
		falla.Vence = e.reloj().Add(time.Duration(segundos) * time.Second)
	}
	e.candado.Lock()
	e.fallas[tipo] = falla
	e.candado.Unlock()

	atributos := []slog.Attr{slog.String("chaos_type", tipo), slog.Any("params", falla.parametros())}
	if segundos > 0 {
		atributos = append(atributos, slog.Int("duration_s", segundos))
	}
	e.logger.LogAttrs(context.Background(), slog.LevelWarn, "caos activado", atributos...)
	return falla, nil
}

// Apagar apaga una falla. Si ya estaba apagada no pasa nada.
func (e *Estado) Apagar(tipo string) error {
	if !slices.Contains(Tipos(), tipo) {
		return ErrFallaDesconocida
	}
	e.candado.Lock()
	_, estaba := e.fallas[tipo]
	delete(e.fallas, tipo)
	e.candado.Unlock()
	if estaba {
		e.logger.LogAttrs(context.Background(), slog.LevelWarn, "caos apagado", slog.String("chaos_type", tipo))
	}
	return nil
}

// ApagarTodo apaga todas las fallas.
func (e *Estado) ApagarTodo() {
	for _, tipo := range Tipos() {
		// Los tipos salen de Tipos(), así que Apagar no puede fallar.
		_ = e.Apagar(tipo)
	}
}

// Vigente devuelve la falla si está encendida y no venció.
func (e *Estado) Vigente(tipo string) (Falla, bool) {
	e.candado.RLock()
	falla, existe := e.fallas[tipo]
	e.candado.RUnlock()
	if !existe || vencida(falla, e.reloj()) {
		return Falla{}, false
	}
	return falla, true
}

// Activa dice si la falla está encendida y no venció.
func (e *Estado) Activa(tipo string) bool {
	_, vigente := e.Vigente(tipo)
	return vigente
}

// Tipos devuelve todas las fallas del servicio.
func (e *Estado) Tipos() []string {
	return Tipos()
}

// Barrer apaga las fallas vencidas, lo deja en el log y devuelve sus tipos.
func (e *Estado) Barrer() []string {
	ahora := e.reloj()
	var vencidas []string
	e.candado.Lock()
	for _, tipo := range Tipos() {
		if falla, existe := e.fallas[tipo]; existe && vencida(falla, ahora) {
			delete(e.fallas, tipo)
			vencidas = append(vencidas, tipo)
		}
	}
	e.candado.Unlock()
	for _, tipo := range vencidas {
		e.logger.LogAttrs(context.Background(), slog.LevelWarn, "caos vencido", slog.String("chaos_type", tipo))
	}
	return vencidas
}

// Resumen devuelve el estado de todas las fallas.
func (e *Estado) Resumen() []Descripcion {
	resumen := make([]Descripcion, 0, len(Tipos()))
	for _, tipo := range Tipos() {
		resumen = append(resumen, e.Describir(tipo))
	}
	return resumen
}

// Describir devuelve el estado de una falla.
func (e *Estado) Describir(tipo string) Descripcion {
	falla, vigente := e.Vigente(tipo)
	if !vigente {
		return Descripcion{Tipo: tipo, Parametros: map[string]any{}}
	}
	descripcion := Descripcion{Tipo: tipo, Activa: true, Parametros: falla.parametros()}
	if !falla.Vence.IsZero() {
		restante := max(0, int(falla.Vence.Sub(e.reloj()).Round(time.Second).Seconds()))
		descripcion.RestanteS = &restante
	}
	return descripcion
}

func vencida(falla Falla, ahora time.Time) bool {
	return !falla.Vence.IsZero() && !ahora.Before(falla.Vence)
}

func invalido(formato string, argumentos ...any) error {
	return fmt.Errorf("%w: %s", ErrParametrosInvalidos, fmt.Sprintf(formato, argumentos...))
}

// validar revisa el cuerpo contra el contrato del tipo. Devuelve la falla sin vencimiento y
// la duración pedida en segundos, que es 0 si no se pidió.
func (e *Estado) validar(tipo string, cuerpo []byte) (Falla, int, error) {
	if !slices.Contains(Tipos(), tipo) {
		return Falla{}, 0, ErrFallaDesconocida
	}
	valores, err := leerObjeto(cuerpo)
	if err != nil {
		return Falla{}, 0, err
	}

	enteros := enterosDe(tipo)
	permitidos := []string{paramDuracion}
	for _, rango := range enteros {
		permitidos = append(permitidos, rango.nombre)
	}
	if admiteRuta(tipo) {
		permitidos = append(permitidos, paramRuta)
	}
	if tipo == Errores {
		permitidos = append(permitidos, ParamStatus)
	}
	slices.Sort(permitidos)
	for nombre := range valores {
		if !slices.Contains(permitidos, nombre) {
			return Falla{}, 0, invalido("%s no admite %s. Admite: %s", tipo, nombre, strings.Join(permitidos, ", "))
		}
	}

	falla := Falla{Tipo: tipo, Enteros: map[string]int{}}
	for _, rango := range enteros {
		valor, err := leerEntero(valores, rango)
		if err != nil {
			return Falla{}, 0, err
		}
		falla.Enteros[rango.nombre] = valor
	}
	if tipo == Errores {
		status, err := leerEntero(valores, entero{nombre: ParamStatus, minimo: 500, maximo: 504, porDefecto: 500})
		if err != nil || !slices.Contains(estadosDeError(), status) {
			return Falla{}, 0, invalido("status debe ser 500, 502, 503 o 504")
		}
		falla.Enteros[ParamStatus] = status
	}
	if valor, viene := valores[paramRuta]; viene {
		ruta, esTexto := valor.(string)
		if !esTexto || !slices.Contains(e.rutas, ruta) {
			return Falla{}, 0, invalido("ruta debe ser una plantilla de negocio: %s", strings.Join(e.rutas, ", "))
		}
		falla.Ruta = ruta
	}
	segundos, err := leerEntero(valores, duracion)
	if err != nil {
		return Falla{}, 0, err
	}
	return falla, segundos, nil
}

// leerObjeto decodifica un objeto JSON. Un cuerpo vacío vale como {}.
func leerObjeto(cuerpo []byte) (map[string]any, error) {
	if len(bytes.TrimSpace(cuerpo)) == 0 {
		return map[string]any{}, nil
	}
	decodificador := json.NewDecoder(bytes.NewReader(cuerpo))
	// Los números quedan como texto, para rechazar 800.5 o 1e3 en vez de redondearlos.
	decodificador.UseNumber()
	var valores map[string]any
	if err := decodificador.Decode(&valores); err != nil || valores == nil {
		return nil, invalido("el cuerpo debe ser un objeto JSON")
	}
	if _, err := decodificador.Token(); !errors.Is(err, io.EOF) {
		return nil, invalido("el cuerpo debe ser un solo objeto JSON")
	}
	return valores, nil
}

func leerEntero(valores map[string]any, rango entero) (int, error) {
	valor, viene := valores[rango.nombre]
	if !viene {
		if rango.obligatorio {
			return 0, invalido("falta %s", rango.nombre)
		}
		return rango.porDefecto, nil
	}
	fueraDeRango := invalido("%s debe ser un entero entre %d y %d", rango.nombre, rango.minimo, rango.maximo)
	numero, esNumero := valor.(json.Number)
	if !esNumero {
		return 0, fueraDeRango
	}
	leido, err := strconv.Atoi(numero.String())
	if err != nil || leido < rango.minimo || leido > rango.maximo {
		return 0, fueraDeRango
	}
	return leido, nil
}
