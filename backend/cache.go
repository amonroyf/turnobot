package main

import (
	"context"
	"log"
	"sync"
	"time"
)

// ---------------------------------------------------------------------------
// Cache de datos del negocio (ttl = 5 minutos)
// ---------------------------------------------------------------------------

type cacheEntry struct {
	data      interface{}
	expiresAt time.Time
}

type NegocioCache struct {
	mu    sync.RWMutex
	items map[string]*cacheEntry
	ttl   time.Duration
}

var negocioCache = &NegocioCache{
	items: make(map[string]*cacheEntry),
	ttl:   5 * time.Minute,
}

func (c *NegocioCache) Get(slug string) (Negocio, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()

	entry, ok := c.items[slug]
	if !ok || time.Now().After(entry.expiresAt) {
		return Negocio{}, false
	}
	neg, ok := entry.data.(Negocio)
	return neg, ok
}

func (c *NegocioCache) Set(slug string, neg Negocio) {
	c.mu.Lock()
	defer c.mu.Unlock()

	c.items[slug] = &cacheEntry{
		data:      neg,
		expiresAt: time.Now().Add(c.ttl),
	}
}

func (c *NegocioCache) Invalidate(slug string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.items, slug)
}

// getCachedNegocio obtiene el negocio completo (doc + subcolecciones) del
// caché o de Firestore. Cachea la respuesta tal como la sirve
// getNegocioHandler para que el endpoint no pegue a Firestore en cada request.
// NOTA: no usar para checks de seguridad frescos (ej. suspended), que deben
// leer Firestore directo o invalidarse explícitamente al cambiar.
func getCachedNegocio(ctx context.Context, slug string) (Negocio, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if neg, ok := negocioCache.Get(slug); ok {
		return neg, nil
	}

	doc, err := firestoreClient.Collection("negocios").Doc(slug).Get(ctx)
	if err != nil {
		return Negocio{}, err
	}

	var neg Negocio
	doc.DataTo(&neg)
	neg.ID = doc.Ref.ID

	// Poblar subcolecciones para que el Set guarde la respuesta completa
	// (el frontend espera servicios/empleados/recursos en la misma respuesta).
	// Arrays nunca nil: la UI hace .map directo.
	neg.Servicios = []Service{}
	neg.Empleados = []Employee{}
	neg.Recursos = []Recurso{}

	if svcsDocs, err := firestoreClient.Collection("negocios").Doc(slug).Collection("servicios").Documents(ctx).GetAll(); err != nil {
		log.Printf("getCachedNegocio: error cargando servicios de %s: %v", slug, err)
	} else {
		for _, d := range svcsDocs {
			var svc Service
			d.DataTo(&svc)
			svc.ID = d.Ref.ID
			neg.Servicios = append(neg.Servicios, svc)
		}
	}

	if empsDocs, err := firestoreClient.Collection("negocios").Doc(slug).Collection("empleados").Documents(ctx).GetAll(); err != nil {
		log.Printf("getCachedNegocio: error cargando empleados de %s: %v", slug, err)
	} else {
		for _, d := range empsDocs {
			var emp Employee
			d.DataTo(&emp)
			emp.ID = d.Ref.ID
			neg.Empleados = append(neg.Empleados, emp)
		}
	}

	if recDocs, err := firestoreClient.Collection("negocios").Doc(slug).Collection("recursos").Documents(ctx).GetAll(); err != nil {
		log.Printf("getCachedNegocio: error cargando recursos de %s: %v", slug, err)
	} else {
		for _, d := range recDocs {
			var rec Recurso
			d.DataTo(&rec)
			rec.ID = d.Ref.ID
			if rec.Capacidad < 1 {
				rec.Capacidad = 1
			}
			neg.Recursos = append(neg.Recursos, rec)
		}
	}

	negocioCache.Set(slug, neg)
	return neg, nil
}
