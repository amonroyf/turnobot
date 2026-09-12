package main

import (
	"net/http"
	"testing"
)

func TestClientIP(t *testing.T) {
	cases := []struct {
		name    string
		xff     string
		xRealIP string
		remote  string
		want    string
	}{
		{"sin headers usa RemoteAddr sin puerto", "", "", "10.0.0.5:1234", "10.0.0.5"},
		{"XFF simple", "203.0.113.7", "", "10.0.0.5:1234", "203.0.113.7"},
		// GFE agrega la IP real al final: el primero puede ser falsificado.
		{"XFF falsificado toma el ultimo", "1.2.3.4, 203.0.113.7", "", "10.0.0.5:1234", "203.0.113.7"},
		{"XFF con espacios", "  1.2.3.4 ,  203.0.113.9  ", "", "10.0.0.5:1", "203.0.113.9"},
		{"X-Real-IP como respaldo", "", "198.51.100.3", "10.0.0.5:1", "198.51.100.3"},
		{"XFF vacio cae a RemoteAddr", "   ", "", "10.0.0.9:8080", "10.0.0.9"},
	}
	for _, c := range cases {
		r, _ := http.NewRequest(http.MethodGet, "/", nil)
		if c.xff != "" {
			r.Header.Set("X-Forwarded-For", c.xff)
		}
		if c.xRealIP != "" {
			r.Header.Set("X-Real-IP", c.xRealIP)
		}
		r.RemoteAddr = c.remote
		if got := clientIP(r); got != c.want {
			t.Errorf("%s: got %q want %q", c.name, got, c.want)
		}
	}
}
