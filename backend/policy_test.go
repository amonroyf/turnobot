package main

import (
	"testing"
	"time"
)

// Reglas de negocio por actor: ventana de cancelación del cliente (2h).
func TestClientePuedeCancelar(t *testing.T) {
	now := time.Now()
	casos := []struct {
		nombre string
		cita   time.Time
		puede  bool
	}{
		{"mañana sí", now.Add(24 * time.Hour), true},
		{"justo 2h sí", now.Add(2 * time.Hour), true},
		{"3h sí", now.Add(3 * time.Hour), true},
		{"1h59 no", now.Add(119 * time.Minute), false},
		{"30min no", now.Add(30 * time.Minute), false},
		{"pasada no", now.Add(-time.Hour), false},
	}
	for _, c := range casos {
		if got := clientePuedeCancelar(c.cita, now); got != c.puede {
			t.Errorf("%s: clientePuedeCancelar = %v, quiero %v", c.nombre, got, c.puede)
		}
	}
}
