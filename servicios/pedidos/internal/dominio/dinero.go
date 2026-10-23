package dominio

import (
	"fmt"
	"strconv"
)

// Dinero es un monto en pesos mexicanos guardado en centavos enteros.
// Nunca pasa por coma flotante, así que 3 x 33.33 da 99.99 exacto.
type Dinero int64

// maxDigitosEnteros acota la parte entera de un precio. Con el máximo de líneas y de cantidad
// por línea, el total siempre cabe en un int64.
const maxDigitosEnteros = 9

// DineroDesdeTexto convierte un texto con dos decimales exactos, como "89.00", a Dinero.
func DineroDesdeTexto(texto string) (Dinero, error) {
	largo := len(texto)
	if largo < 4 || largo > maxDigitosEnteros+3 || texto[largo-3] != '.' {
		return 0, fmt.Errorf("%w: %q", ErrMontoInvalido, texto)
	}
	digitos := texto[:largo-3] + texto[largo-2:]
	for _, c := range digitos {
		if c < '0' || c > '9' {
			return 0, fmt.Errorf("%w: %q", ErrMontoInvalido, texto)
		}
	}
	centavos, err := strconv.ParseInt(digitos, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("%w: %q", ErrMontoInvalido, texto)
	}
	return Dinero(centavos), nil
}

// Por multiplica el monto por una cantidad entera.
func (d Dinero) Por(cantidad int) Dinero {
	return d * Dinero(cantidad)
}

// Texto devuelve el monto con dos decimales exactos, como "99.99".
func (d Dinero) Texto() string {
	return fmt.Sprintf("%d.%02d", int64(d)/100, int64(d)%100)
}
