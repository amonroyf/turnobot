package main

import (
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

// getCachedNegocio obtiene el negocio del caché o de Firestore.
func getCachedNegocio(slug string) (Negocio, error) {
	if neg, ok := negocioCache.Get(slug); ok {
		return neg, nil
	}

	doc, err := firestoreClient.Collection("negocios").Doc(slug).Get(nil) // Background context
	if err != nil {
		return Negocio{}, err
	}

	var neg Negocio
	doc.DataTo(&neg)
	neg.ID = doc.Ref.ID
	negocioCache.Set(slug, neg)
	return neg, nil
}

// ---------------------------------------------------------------------------
// Pool de goroutines para operaciones async (push, CRM updates)
// ---------------------------------------------------------------------------

type WorkerPool struct {
	workers chan struct{}
	wg      sync.WaitGroup
}

var pushPool = &WorkerPool{
	workers: make(chan struct{}, 10), // máximo 10 goroutines concurrentes para push
}

func (p *WorkerPool) Submit(fn func()) {
	p.wg.Add(1)
	go func() {
		defer p.wg.Done()
		p.workers <- struct{}{} // Adquirir slot
		defer func() { <-p.workers }()
		fn()
	}()
}

func (p *WorkerPool) Wait() {
	p.wg.Wait()
}

// submitPush envía push de forma asíncrona con límite de concurrencia.
func submitPush(fn func()) {
	pushPool.Submit(fn)
}
