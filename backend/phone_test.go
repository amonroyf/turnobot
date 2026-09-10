package main

import (
	"testing"
	"time"
)

func TestSanitizePhone(t *testing.T) {
	cases := []struct {
		in     string
		want   string
		hasErr bool
	}{
		{"3001234567", "+573001234567", false},
		{"300 123 4567", "+573001234567", false},
		{"573001234567", "+573001234567", false},
		{"+573001234567", "+573001234567", false},
		{"1111111111", "", true},
		{"2222222222", "", true},
		{"1234567890", "", true},
		{"3000000001", "+573000000001", false},
		{"3000000002", "+573000000002", false},
	}
	for _, c := range cases {
		got, err := sanitizePhone(c.in, defaultPhoneRegion)
		if c.hasErr {
			if err == nil {
				t.Errorf("sanitizePhone(%q) = %q, esperaba error", c.in, got)
			}
			continue
		}
		if err != nil {
			t.Errorf("sanitizePhone(%q) error inesperado: %v", c.in, err)
			continue
		}
		if got != c.want {
			t.Errorf("sanitizePhone(%q) = %q, esperaba %q", c.in, got, c.want)
		}
	}
}

func TestParsePriceVal(t *testing.T) {
	cases := []struct {
		in   string
		want int
	}{
		{"45000", 45000},
		{"45.000", 45000},
		{"$45.000", 45000},
		{"$ 45.000", 45000},
		{"", 0},
		{"sin-precio", 0},
		{"abc", 0},
	}
	for _, c := range cases {
		if got := parsePriceVal(c.in); got != c.want {
			t.Errorf("parsePriceVal(%q) = %d, esperaba %d", c.in, got, c.want)
		}
	}
}

func TestPhoneQueryKeys(t *testing.T) {
	cases := []struct {
		phone string
		min   int // mínimo de variantes esperadas
	}{
		{"3001234567", 1},
		{"+573001234567", 1},
		{"", 0},
	}
	for _, c := range cases {
		keys := phoneQueryKeys(c.phone)
		if len(keys) < c.min {
			t.Errorf("phoneQueryKeys(%q) devolvió %d variantes, mínimo esperado %d", c.phone, len(keys), c.min)
		}
		// Verificar que no haya vacíos
		for _, k := range keys {
			if k == "" {
				t.Errorf("phoneQueryKeys(%q) contiene un string vacío", c.phone)
			}
		}
	}
	// Verificar que +57 y sin prefijo generan la misma clave E.164
	keys1 := phoneQueryKeys("3001234567")
	keys2 := phoneQueryKeys("+573001234567")
	for _, k := range keys2 {
		found := false
		for _, k2 := range keys1 {
			if k == k2 {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("phoneQueryKeys: la clave %q de +573001234567 no se encontró en las variantes de 3001234567", k)
		}
	}
}

func TestDigitsOnly(t *testing.T) {
	cases := []struct {
		in, want string
	}{
	{"+57 300 123 4567", "573001234567"},
	{"300.123.4567", "3001234567"},
	{"abc", ""},
	{"", ""},
	}
	for _, c := range cases {
		if got := digitsOnly(c.in); got != c.want {
			t.Errorf("digitsOnly(%q) = %q, esperaba %q", c.in, got, c.want)
		}
	}
}

func TestParseClock(t *testing.T) {
	cases := []struct {
		in     string
		ok     bool
		hour   int
		minute int
	}{
		{"09:00", true, 9, 0},
		{"23:59", true, 23, 59},
		{"", false, 0, 0},
		{"invalid", false, 0, 0},
		{"25:00", false, 0, 0},
	}
	for _, c := range cases {
		ok, h, m := parseClock(c.in)
		if ok != c.ok || h != c.hour || m != c.minute {
			t.Errorf("parseClock(%q) = (%v, %d, %d), esperaba (%v, %d, %d)", c.in, ok, h, m, c.ok, c.hour, c.minute)
		}
	}
}

func TestBearerToken(t *testing.T) {
	cases := []struct {
		in, want string
	}{
		{"Bearer abc123", "abc123"},
		{"Bearer ", ""},
		{"Basic abc123", ""},
		{"", ""},
	}
	for _, c := range cases {
		if got := bearerToken(c.in); got != c.want {
			t.Errorf("bearerToken(%q) = %q, esperaba %q", c.in, got, c.want)
		}
	}
}

func TestEmployeeDayHorario(t *testing.T) {
	h := &HorarioSemanal{
		Lunes:    DiaHorario{Activo: true, Turnos: []Turno{{Inicio: "09:00", Fin: "12:00"}}},
		Martes:   DiaHorario{Activo: false},
		Domingo:  DiaHorario{Activo: false},
	}

	// Lunes activo
	dia := employeeDayHorario(h, time.Monday)
	if dia == nil || !dia.Activo {
		t.Error("employeeDayHorario(Monday) debería devolver día activo")
	}

	// Martes inactivo
	dia = employeeDayHorario(h, time.Tuesday)
	if dia == nil {
		t.Error("employeeDayHorario(Tuesday) no debería ser nil")
	}
	if dia.Activo {
		t.Error("employeeDayHorario(Tuesday) debería estar inactivo")
	}

	// nil schedule
	dia = employeeDayHorario(nil, time.Monday)
	if dia != nil {
		t.Error("employeeDayHorario(nil, Monday) debería devolver nil")
	}
}

// TestSplitShiftIntervals verifica la lógica de filtrado de turnos.
// Nota: splitShiftIntervals llama shopLocation (necesita Firestore), así que
// solo testeamos los casos que retornan nil antes de llegar a shopLocation.
func TestSplitShiftIntervals(t *testing.T) {
	day := time.Date(2026, 9, 14, 0, 0, 0, 0, time.UTC) // Monday

	// Día inactivo -> nil (sale antes de llamar shopLocation)
	diaInactivo := &DiaHorario{Activo: false}
	intervals := splitShiftIntervals(nil, "test-slug", diaInactivo, day)
	if intervals != nil {
		t.Error("splitShiftIntervals: día inactivo debería devolver nil")
	}

	// Sin turnos -> nil
	diaSinTurnos := &DiaHorario{Activo: true, Turnos: []Turno{}}
	intervals = splitShiftIntervals(nil, "test-slug", diaSinTurnos, day)
	if intervals != nil {
		t.Error("splitShiftIntervals: sin turnos debería devolver nil")
	}

	// Nil -> nil
	intervals = splitShiftIntervals(nil, "test-slug", nil, day)
	if intervals != nil {
		t.Error("splitShiftIntervals: nil debería devolver nil")
	}
}
