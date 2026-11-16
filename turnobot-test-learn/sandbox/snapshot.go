package sandbox

import (
	"context"
	"strings"

	"cloud.google.com/go/firestore"
	"google.golang.org/api/iterator"
)

// Snapshot captura el estado de las colecciones indicadas filtrando por un campo.
//
// Las colecciones se pueden pasar de dos formas:
//
//	"reservas"                  -> colección de raíz, filtrada por filterField
//	"negocios/mi-negocio/servicios" -> subcolección (documento + subcolección)
//
// Antes solo se soportaba la raíz, así que `empleados`, `servicios` y
// `recursos` (que viven en subcolecciones de `negocios/{slug}`) quedaban
// fuera del reporte. Ahora se aceptan ambas formas.
func Snapshot(ctx context.Context, client *firestore.Client, collections []string, filterField string, filterValue interface{}) map[string]interface{} {
	state := make(map[string]interface{})
	if client == nil {
		return state
	}
	for _, collName := range collections {
		collState := make(map[string]interface{})
		ref, filterable := resolveCollection(client, collName)
		if ref == nil {
			continue
		}
		q := ref.Query
		if filterable && filterField != "" {
			q = q.Where(filterField, "==", filterValue)
		}
		iter := q.Documents(ctx)
		for {
			doc, err := iter.Next()
			if err == iterator.Done {
				break
			}
			if err != nil {
				continue
			}
			collState[doc.Ref.ID] = doc.Data()
		}
		iter.Stop()
		state[collName] = collState
	}
	return state
}

// resolveCollection traduce una ruta de colección a su CollectionRef.
//
// Formatos aceptados:
//
//	"reservas"                        -> colección de raíz
//	"negocios/mi-negocio/empleados"   -> subcolección
//
// Devuelve (ref, filtrable). `filtrable` es false para subcolecciones: el
// documento padre ya acota el conjunto, así que aplicar el filtro de
// `negocio_id` sobre un doc que no lo tiene devolvería cero resultados.
func resolveCollection(client *firestore.Client, path string) (*firestore.CollectionRef, bool) {
	parts := strings.Split(strings.Trim(path, "/"), "/")
	switch len(parts) {
	case 1:
		if parts[0] == "" {
			return nil, false
		}
		return client.Collection(parts[0]), true
	case 3:
		if parts[0] == "" || parts[1] == "" || parts[2] == "" {
			return nil, false
		}
		return client.Collection(parts[0]).Doc(parts[1]).Collection(parts[2]), false
	default:
		return nil, false
	}
}
