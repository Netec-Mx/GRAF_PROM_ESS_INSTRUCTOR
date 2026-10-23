package dominio_test

import (
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/RodrigoMSB/graf-prom-ess/servicios/pedidos/internal/dominio"
)

func TestDineroDesdeTexto(t *testing.T) {
	validos := map[string]dominio.Dinero{
		"0.00":         0,
		"0.05":         5,
		"33.33":        3333,
		"89.00":        8900,
		"620.00":       62000,
		"999999999.99": 99999999999,
	}
	for texto, esperado := range validos {
		obtenido, err := dominio.DineroDesdeTexto(texto)
		if err != nil {
			t.Errorf("DineroDesdeTexto(%q) devolvió error: %v", texto, err)
		}
		if obtenido != esperado {
			t.Errorf("DineroDesdeTexto(%q) = %d, esperaba %d", texto, obtenido, esperado)
		}
	}

	invalidos := []string{"", "89", "89.0", "89.000", "89,00", ".00", "-1.00", "1e3.00", "8 9.00", "1234567890.00", "12.3x"}
	for _, texto := range invalidos {
		if _, err := dominio.DineroDesdeTexto(texto); !errors.Is(err, dominio.ErrMontoInvalido) {
			t.Errorf("DineroDesdeTexto(%q) debía devolver ErrMontoInvalido, devolvió %v", texto, err)
		}
	}
}

func TestDineroTextoConservaLosDosDecimales(t *testing.T) {
	casos := map[dominio.Dinero]string{0: "0.00", 5: "0.05", 8900: "89.00", 9999: "99.99", 123456: "1234.56"}
	for monto, esperado := range casos {
		if obtenido := monto.Texto(); obtenido != esperado {
			t.Errorf("Dinero(%d).Texto() = %q, esperaba %q", monto, obtenido, esperado)
		}
	}
}

// Con float64, 3 * 33.33 da 99.99000000000001. Con centavos enteros da 99.99 exacto.
func TestTotalSinPerdida(t *testing.T) {
	precio, err := dominio.DineroDesdeTexto("33.33")
	if err != nil {
		t.Fatal(err)
	}
	if obtenido := precio.Por(3).Texto(); obtenido != "99.99" {
		t.Errorf(`3 x "33.33" = %q, esperaba "99.99"`, obtenido)
	}

	centavo, err := dominio.DineroDesdeTexto("0.10")
	if err != nil {
		t.Fatal(err)
	}
	var suma dominio.Dinero
	for range 3 {
		suma += centavo
	}
	if obtenido := suma.Texto(); obtenido != "0.30" {
		t.Errorf(`"0.10" + "0.10" + "0.10" = %q, esperaba "0.30"`, obtenido)
	}
}

func TestValidarSolicitud(t *testing.T) {
	muchas := make([]dominio.LineaSolicitada, 0, dominio.MaxLineas+1)
	for i := range dominio.MaxLineas + 1 {
		muchas = append(muchas, dominio.LineaSolicitada{SKU: "TNG-" + strings.Repeat("A", i+1), Cantidad: 1})
	}

	invalidas := map[string][]dominio.LineaSolicitada{
		"sin líneas":           {},
		"demasiadas líneas":    muchas,
		"sku vacío":            {{SKU: "", Cantidad: 1}},
		"sku con barra":        {{SKU: "TNG-0001/../salud", Cantidad: 1}},
		"sku con espacio":      {{SKU: "TNG 0001", Cantidad: 1}},
		"sku demasiado largo":  {{SKU: strings.Repeat("A", dominio.MaxLargoSKU+1), Cantidad: 1}},
		"cantidad cero":        {{SKU: "TNG-0001", Cantidad: 0}},
		"cantidad negativa":    {{SKU: "TNG-0001", Cantidad: -2}},
		"cantidad desmesurada": {{SKU: "TNG-0001", Cantidad: dominio.MaxCantidad + 1}},
		"sku repetido":         {{SKU: "TNG-0001", Cantidad: 1}, {SKU: "TNG-0001", Cantidad: 2}},
	}
	for nombre, lineas := range invalidas {
		if err := dominio.ValidarSolicitud(lineas); !errors.Is(err, dominio.ErrPedidoInvalido) {
			t.Errorf("%s: esperaba ErrPedidoInvalido, obtuve %v", nombre, err)
		}
	}

	valida := []dominio.LineaSolicitada{{SKU: "TNG-0001", Cantidad: 2}, {SKU: "TNG-0002", Cantidad: dominio.MaxCantidad}}
	if err := dominio.ValidarSolicitud(valida); err != nil {
		t.Errorf("una solicitud válida devolvió error: %v", err)
	}
}

func TestNuevoPedido(t *testing.T) {
	ahora := time.Date(2026, 10, 11, 12, 0, 0, 0, time.UTC)
	catalogo := map[string]dominio.Disponibilidad{
		"TNG-0001": {Existe: true, Nombre: "Aguacate Hass (kg)", Precio: 8900, Stock: 40},
		"TNG-0002": {Existe: true, Nombre: "Jitomate saladet (kg)", Precio: 3333, Stock: 3},
		"TNG-0005": {Existe: true, Nombre: "Mango ataulfo (kg)", Precio: 5400, Stock: 0},
	}

	t.Run("confirmado suma los subtotales", func(t *testing.T) {
		pedido := dominio.NuevoPedido([]dominio.LineaSolicitada{
			{SKU: "TNG-0001", Cantidad: 2}, {SKU: "TNG-0002", Cantidad: 3},
		}, catalogo, ahora)
		if pedido.Estado != dominio.EstadoConfirmado {
			t.Fatalf("estado = %s", pedido.Estado)
		}
		if pedido.Total.Texto() != "277.99" {
			t.Errorf("total = %s, esperaba 277.99", pedido.Total.Texto())
		}
		if len(pedido.SKUsRechazados) != 0 || pedido.ID != "" || !pedido.CreadoEn.Equal(ahora) {
			t.Errorf("pedido inesperado: %+v", pedido)
		}
		if pedido.Lineas[1].Subtotal().Texto() != "99.99" || !pedido.Lineas[1].ConPrecio {
			t.Errorf("línea inesperada: %+v", pedido.Lineas[1])
		}
	})

	t.Run("la cantidad igual al stock se confirma", func(t *testing.T) {
		pedido := dominio.NuevoPedido([]dominio.LineaSolicitada{{SKU: "TNG-0001", Cantidad: 40}}, catalogo, ahora)
		if pedido.Estado != dominio.EstadoConfirmado {
			t.Errorf("estado = %s", pedido.Estado)
		}
	})

	t.Run("sin stock", func(t *testing.T) {
		pedido := dominio.NuevoPedido([]dominio.LineaSolicitada{
			{SKU: "TNG-0001", Cantidad: 1}, {SKU: "TNG-0005", Cantidad: 1},
		}, catalogo, ahora)
		if pedido.Estado != dominio.EstadoRechazadoSinStock {
			t.Fatalf("estado = %s", pedido.Estado)
		}
		if pedido.Total != 0 || len(pedido.SKUsRechazados) != 1 || pedido.SKUsRechazados[0] != "TNG-0005" {
			t.Errorf("pedido inesperado: %+v", pedido)
		}
	})

	t.Run("el sku inexistente pesa más que la falta de stock", func(t *testing.T) {
		pedido := dominio.NuevoPedido([]dominio.LineaSolicitada{
			{SKU: "TNG-0005", Cantidad: 1}, {SKU: "TNG-9999", Cantidad: 1},
		}, catalogo, ahora)
		if pedido.Estado != dominio.EstadoRechazadoSKUInexistente {
			t.Fatalf("estado = %s", pedido.Estado)
		}
		if len(pedido.SKUsRechazados) != 1 || pedido.SKUsRechazados[0] != "TNG-9999" {
			t.Errorf("sku rechazados = %v", pedido.SKUsRechazados)
		}
		if pedido.Lineas[1].ConPrecio || pedido.Total != 0 {
			t.Errorf("pedido inesperado: %+v", pedido)
		}
	})
}
