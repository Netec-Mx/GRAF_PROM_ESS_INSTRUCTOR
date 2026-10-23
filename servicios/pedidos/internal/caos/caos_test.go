package caos_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"strings"
	"testing"
	"time"

	"github.com/RodrigoMSB/graf-prom-ess/servicios/pedidos/internal/caos"
)

const mib = 1024 * 1024

// relojFalso avanza solo cuando la prueba lo dice.
type relojFalso struct {
	ahora time.Time
}

func (r *relojFalso) Ahora() time.Time {
	return r.ahora
}

func (r *relojFalso) avanzar(lapso time.Duration) {
	r.ahora = r.ahora.Add(lapso)
}

func nuevoEstado(salida io.Writer) (*caos.Estado, *relojFalso) {
	reloj := &relojFalso{ahora: time.Date(2026, 10, 12, 12, 0, 0, 0, time.UTC)}
	logger := slog.New(slog.NewJSONHandler(salida, nil))
	return caos.NuevoEstado([]string{"/pedidos", "/pedidos/{id}"}, reloj.Ahora, logger), reloj
}

func TestActivarAplicaLosValoresPorDefecto(t *testing.T) {
	estado, _ := nuevoEstado(io.Discard)

	falla, err := estado.Activar(caos.Latencia, []byte(`{"ms": 800}`))
	if err != nil {
		t.Fatalf("Activar: %v", err)
	}
	if falla.Enteros[caos.ParamMs] != 800 || falla.Enteros[caos.ParamJitterMs] != 0 || falla.Enteros[caos.ParamPorcentaje] != 100 {
		t.Errorf("enteros = %v", falla.Enteros)
	}
	if !falla.Vence.IsZero() || falla.Ruta != "" {
		t.Errorf("sin duracion_s ni ruta no debe traer vencimiento ni ruta: %+v", falla)
	}

	errores, err := estado.Activar(caos.Errores, nil)
	if err != nil {
		t.Fatalf("Activar errores sin cuerpo: %v", err)
	}
	if errores.Enteros[caos.ParamStatus] != 500 || errores.Enteros[caos.ParamPorcentaje] != 100 {
		t.Errorf("enteros de errores = %v", errores.Enteros)
	}
}

func TestLosLimitesDeCadaRangoSonValidos(t *testing.T) {
	casos := map[string]string{
		caos.Latencia:     `{"ms":10000,"jitter_ms":5000,"porcentaje":1,"ruta":"/pedidos/{id}","duracion_s":86400}`,
		caos.Errores:      `{"porcentaje":100,"status":504,"ruta":"/pedidos","duracion_s":1}`,
		caos.Cardinalidad: `{}`,
		caos.Memoria:      `{"mb_por_minuto":200}`,
	}
	for tipo, cuerpo := range casos {
		estado, _ := nuevoEstado(io.Discard)
		if _, err := estado.Activar(tipo, []byte(cuerpo)); err != nil {
			t.Errorf("%s con %s: %v", tipo, cuerpo, err)
		}
		if !estado.Activa(tipo) {
			t.Errorf("%s debería quedar activa", tipo)
		}
	}
}

func TestParametrosFueraDeContrato(t *testing.T) {
	casos := []struct{ tipo, cuerpo string }{
		{caos.Latencia, `{}`},
		{caos.Latencia, `{"ms":0}`},
		{caos.Latencia, `{"ms":10001}`},
		{caos.Latencia, `{"ms":"800"}`},
		{caos.Latencia, `{"ms":800.5}`},
		{caos.Latencia, `{"ms":8e2}`},
		{caos.Latencia, `{"ms":true}`},
		{caos.Latencia, `{"ms":null}`},
		{caos.Latencia, `{"ms":800,"jitter_ms":-1}`},
		{caos.Latencia, `{"ms":800,"jitter_ms":5001}`},
		{caos.Latencia, `{"ms":800,"porcentaje":0}`},
		{caos.Latencia, `{"ms":800,"porcentaje":101}`},
		{caos.Latencia, `{"ms":800,"ruta":"/pedidos/PED-000001"}`},
		{caos.Latencia, `{"ms":800,"ruta":"/salud"}`},
		{caos.Latencia, `{"ms":800,"ruta":5}`},
		{caos.Latencia, `{"ms":800,"status":503}`},
		{caos.Latencia, `{"ms":800,"duracion_s":0}`},
		{caos.Latencia, `{"ms":800,"duracion_s":86401}`},
		{caos.Latencia, `{"ms":800,"inventado":1}`},
		{caos.Latencia, `[800]`},
		{caos.Latencia, `null`},
		{caos.Latencia, `ms=800`},
		{caos.Latencia, `{"ms":800}{"ms":900}`},
		{caos.Errores, `{"porcentaje":0}`},
		{caos.Errores, `{"status":404}`},
		{caos.Errores, `{"status":501}`},
		{caos.Errores, `{"status":"503"}`},
		{caos.Cardinalidad, `{"ms":1}`},
		{caos.Memoria, `{}`},
		{caos.Memoria, `{"mb_por_minuto":0}`},
		{caos.Memoria, `{"mb_por_minuto":201}`},
	}
	for _, caso := range casos {
		estado, _ := nuevoEstado(io.Discard)
		_, err := estado.Activar(caso.tipo, []byte(caso.cuerpo))
		if !errors.Is(err, caos.ErrParametrosInvalidos) {
			t.Errorf("%s con %s: err = %v, quería ErrParametrosInvalidos", caso.tipo, caso.cuerpo, err)
		}
		if estado.Activa(caso.tipo) {
			t.Errorf("%s con %s quedó activa", caso.tipo, caso.cuerpo)
		}
	}
}

func TestTipoDesconocido(t *testing.T) {
	estado, _ := nuevoEstado(io.Discard)

	if _, err := estado.Activar("pasarela_lenta", []byte(`{}`)); !errors.Is(err, caos.ErrFallaDesconocida) {
		t.Errorf("Activar: err = %v", err)
	}
	if err := estado.Apagar("pasarela_lenta"); !errors.Is(err, caos.ErrFallaDesconocida) {
		t.Errorf("Apagar: err = %v", err)
	}
}

func TestApagarYApagarTodo(t *testing.T) {
	estado, _ := nuevoEstado(io.Discard)
	for _, tipo := range []string{caos.Errores, caos.Cardinalidad} {
		if _, err := estado.Activar(tipo, nil); err != nil {
			t.Fatal(err)
		}
	}

	if err := estado.Apagar(caos.Errores); err != nil {
		t.Fatal(err)
	}
	if err := estado.Apagar(caos.Errores); err != nil {
		t.Errorf("apagar dos veces no debe fallar: %v", err)
	}
	if estado.Activa(caos.Errores) || !estado.Activa(caos.Cardinalidad) {
		t.Error("Apagar debe apagar solo la falla pedida")
	}

	estado.ApagarTodo()
	for _, descripcion := range estado.Resumen() {
		if descripcion.Activa {
			t.Errorf("%s sigue activa después de ApagarTodo", descripcion.Tipo)
		}
	}
}

func TestResumenTraeTodasLasFallasEnOrden(t *testing.T) {
	estado, _ := nuevoEstado(io.Discard)
	if _, err := estado.Activar(caos.Latencia, []byte(`{"ms":800,"ruta":"/pedidos","duracion_s":90}`)); err != nil {
		t.Fatal(err)
	}

	texto, err := json.Marshal(estado.Resumen())
	if err != nil {
		t.Fatal(err)
	}
	esperado := `[{"tipo":"latencia","activa":true,"restante_s":90,"parametros":{"jitter_ms":0,"ms":800,"porcentaje":100,"ruta":"/pedidos"}},` +
		`{"tipo":"errores","activa":false,"restante_s":null,"parametros":{}},` +
		`{"tipo":"cardinalidad","activa":false,"restante_s":null,"parametros":{}},` +
		`{"tipo":"memoria","activa":false,"restante_s":null,"parametros":{}}]`
	if string(texto) != esperado {
		t.Errorf("resumen =\n%s\nquería\n%s", texto, esperado)
	}
}

func TestConDuracionLaFallaSeApagaSola(t *testing.T) {
	logs := &bytes.Buffer{}
	estado, reloj := nuevoEstado(logs)
	if _, err := estado.Activar(caos.Latencia, []byte(`{"ms":100,"duracion_s":60}`)); err != nil {
		t.Fatal(err)
	}
	if _, err := estado.Activar(caos.Cardinalidad, nil); err != nil {
		t.Fatal(err)
	}
	logs.Reset()

	reloj.avanzar(59 * time.Second)
	if !estado.Activa(caos.Latencia) {
		t.Fatal("a los 59 s todavía debe estar activa")
	}
	if restante := estado.Describir(caos.Latencia).RestanteS; restante == nil || *restante != 1 {
		t.Errorf("restante_s = %v, quería 1", restante)
	}
	if vencidas := estado.Barrer(); len(vencidas) != 0 {
		t.Errorf("Barrer antes de tiempo apagó %v", vencidas)
	}

	reloj.avanzar(time.Second)
	if estado.Activa(caos.Latencia) {
		t.Error("a los 60 s ya no debe estar activa, aunque nadie haya barrido")
	}
	if vencidas := estado.Barrer(); len(vencidas) != 1 || vencidas[0] != caos.Latencia {
		t.Errorf("Barrer = %v, quería [latencia]", vencidas)
	}
	if vencidas := estado.Barrer(); len(vencidas) != 0 {
		t.Errorf("el segundo Barrer apagó %v", vencidas)
	}
	if !estado.Activa(caos.Cardinalidad) {
		t.Error("una falla sin duracion_s no vence")
	}

	var linea map[string]any
	if err := json.Unmarshal(logs.Bytes(), &linea); err != nil {
		t.Fatalf("se esperaba una sola línea de log JSON, hay: %q", logs.String())
	}
	if linea["msg"] != "caos vencido" || linea["chaos_type"] != caos.Latencia {
		t.Errorf("línea de vencimiento = %v", linea)
	}
}

func TestCadaCambioDejaUnaLineaDeLog(t *testing.T) {
	logs := &bytes.Buffer{}
	estado, _ := nuevoEstado(logs)

	if _, err := estado.Activar(caos.Latencia, []byte(`{"ms":800,"porcentaje":50,"duracion_s":600}`)); err != nil {
		t.Fatal(err)
	}
	_ = estado.Apagar(caos.Latencia)
	_ = estado.Apagar(caos.Latencia)

	lineas := strings.Split(strings.TrimSpace(logs.String()), "\n")
	if len(lineas) != 2 {
		t.Fatalf("quería 2 líneas (activado y apagado), hay %d: %q", len(lineas), logs.String())
	}
	var activado struct {
		Msg       string         `json:"msg"`
		Tipo      string         `json:"chaos_type"`
		Params    map[string]int `json:"params"`
		DuracionS int            `json:"duration_s"`
	}
	if err := json.Unmarshal([]byte(lineas[0]), &activado); err != nil {
		t.Fatal(err)
	}
	if activado.Msg != "caos activado" || activado.Tipo != caos.Latencia || activado.DuracionS != 600 ||
		activado.Params["ms"] != 800 || activado.Params["porcentaje"] != 50 {
		t.Errorf("línea de activación = %+v", activado)
	}
	if !strings.Contains(lineas[1], `"msg":"caos apagado"`) {
		t.Errorf("segunda línea = %s", lineas[1])
	}
}

func TestLaFugaRetieneAlRitmoPedidoYSueltaAlApagar(t *testing.T) {
	estado, _ := nuevoEstado(io.Discard)
	fuga := &caos.Fuga{}
	motor := caos.NuevoMotor(estado, fuga)
	if _, err := estado.Activar(caos.Memoria, []byte(`{"mb_por_minuto":60}`)); err != nil {
		t.Fatal(err)
	}

	motor.Avanzar(time.Second)
	motor.Avanzar(time.Second)
	if fuga.Retenido() != 2*mib {
		t.Errorf("retenido = %d, quería %d", fuga.Retenido(), 2*mib)
	}

	_ = estado.Apagar(caos.Memoria)
	motor.Avanzar(time.Second)
	if fuga.Retenido() != 0 {
		t.Errorf("después de apagar retiene %d", fuga.Retenido())
	}
}

func TestLaFugaNoPierdeLosBytesQueNoCompletanUnPaso(t *testing.T) {
	fuga := &caos.Fuga{}
	for range 600 {
		fuga.Retener(1, 100*time.Millisecond)
	}
	if fuga.Retenido() < mib-600 || fuga.Retenido() > mib {
		t.Errorf("retenido = %d, quería cerca de %d", fuga.Retenido(), mib)
	}
}

func TestElMotorSueltaLaMemoriaCuandoLaFugaVence(t *testing.T) {
	estado, reloj := nuevoEstado(io.Discard)
	fuga := &caos.Fuga{}
	motor := caos.NuevoMotor(estado, fuga)
	if _, err := estado.Activar(caos.Memoria, []byte(`{"mb_por_minuto":60,"duracion_s":10}`)); err != nil {
		t.Fatal(err)
	}
	motor.Avanzar(time.Second)
	if fuga.Retenido() != mib {
		t.Fatalf("retenido = %d", fuga.Retenido())
	}

	reloj.avanzar(10 * time.Second)
	motor.Avanzar(time.Second)
	if fuga.Retenido() != 0 {
		t.Errorf("la fuga venció y todavía retiene %d", fuga.Retenido())
	}
	if estado.Activa(caos.Memoria) {
		t.Error("la fuga debería haber vencido")
	}
}

func TestElMotorCorreHastaQueSeCancelaElContexto(t *testing.T) {
	estado, _ := nuevoEstado(io.Discard)
	fuga := &caos.Fuga{}
	if _, err := estado.Activar(caos.Memoria, []byte(`{"mb_por_minuto":200}`)); err != nil {
		t.Fatal(err)
	}
	ctx, cancelar := context.WithTimeout(t.Context(), 50*time.Millisecond)
	defer cancelar()

	caos.NuevoMotor(estado, fuga).Correr(ctx, time.Millisecond)

	if fuga.Retenido() == 0 {
		t.Error("el motor no hizo crecer la fuga")
	}
}
