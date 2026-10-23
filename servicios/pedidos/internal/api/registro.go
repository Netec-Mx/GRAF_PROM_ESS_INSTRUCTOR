package api

import (
	"io"
	"log/slog"
)

// Servicio es el valor del campo service en cada línea de log.
const Servicio = "pedidos"

// NuevoLogger crea el logger JSON del servicio. Cada línea lleva time, level, msg y service.
// El nivel sale en minúsculas (info, warning, error), igual que en catalogo.
func NuevoLogger(salida io.Writer) *slog.Logger {
	opciones := &slog.HandlerOptions{
		ReplaceAttr: func(grupos []string, atributo slog.Attr) slog.Attr {
			if len(grupos) == 0 && atributo.Key == slog.LevelKey {
				if nivel, esNivel := atributo.Value.Any().(slog.Level); esNivel {
					atributo.Value = slog.StringValue(nombreDeNivel(nivel))
				}
			}
			return atributo
		},
	}
	return slog.New(slog.NewJSONHandler(salida, opciones)).With(slog.String("service", Servicio))
}

func nombreDeNivel(nivel slog.Level) string {
	switch {
	case nivel >= slog.LevelError:
		return "error"
	case nivel >= slog.LevelWarn:
		return "warning"
	case nivel >= slog.LevelInfo:
		return "info"
	default:
		return "debug"
	}
}
