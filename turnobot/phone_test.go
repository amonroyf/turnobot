package main

import "testing"

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