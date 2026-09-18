package main

import (
	"testing"
	"time"
)

// Reglas de negocio por actor: ventana de cancelación del cliente.
// Estándar del mercado (Vagaro/Booksy): 24h por defecto, configurable 1-72h.
func TestClientePuedeCancelar(t *testing.T) {
	now := time.Now()
	casos := []struct {
		nombre string
		cita   time.Time
		horas  int
		puede  bool
	}{
		{"24h default: mañana sí", now.Add(24 * time.Hour), 24, true},
		{"24h default: justo 24h sí", now.Add(24 * time.Hour), 24, true},
		{"24h default: 23h no", now.Add(23 * time.Hour), 24, false},
		{"48h spa: 30h no", now.Add(30 * time.Hour), 48, false},
		{"48h spa: 50h sí", now.Add(50 * time.Hour), 48, true},
		{"2h flexible: 3h sí", now.Add(3 * time.Hour), 2, true},
		{"2h flexible: 1h no", now.Add(time.Hour), 2, false},
		{"pasada no", now.Add(-time.Hour), 24, false},
		{"ventana inválida cae a 24h", now.Add(23 * time.Hour), 0, false},
	}
	for _, c := range casos {
		if got := clientePuedeCancelar(c.cita, now, c.horas); got != c.puede {
			t.Errorf("%s: clientePuedeCancelar = %v, quiero %v", c.nombre, got, c.puede)
		}
	}
}

// Throttle por teléfono: los primeros N intentos pasan, el resto se frena,
// y con el tiempo se recuperan (token bucket).
func TestPhoneBookLimiter(t *testing.T) {
	rl := newRateLimiter(2, time.Hour)
	key := "test-phone-throttle"
	if !rl.allowKey(key) || !rl.allowKey(key) {
		t.Fatal("los 2 primeros intentos deberían pasar")
	}
	if rl.allowKey(key) {
		t.Fatal("el 3er intento debería frenarse")
	}
}
// Ventana de undo por acción (no por fecha de la cita): permite corregir al
// día siguiente un no-show marcado tarde.
func TestMarcaReciente(t *testing.T) {
	now := time.Now()
	if !marcaReciente(now.Add(-time.Hour), 24*time.Hour) {
		t.Error("hace 1h debería ser reciente en ventana 24h")
	}
	if marcaReciente(now.Add(-25*time.Hour), 24*time.Hour) {
		t.Error("hace 25h no debería ser reciente en ventana 24h")
	}
	if marcaReciente(nil, 24*time.Hour) {
		t.Error("ausente no debería ser reciente")
	}
	if marcaReciente(time.Time{}, 24*time.Hour) {
		t.Error("cero no debería ser reciente")
	}
	if marcaReciente("ayer", 24*time.Hour) {
		t.Error("tipo inválido no debería ser reciente")
	}
}
