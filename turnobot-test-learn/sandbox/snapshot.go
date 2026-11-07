package sandbox

import (
	"context"

	"cloud.google.com/go/firestore"
	"google.golang.org/api/iterator"
)

// Snapshot captura el estado de las colecciones indicadas filtrando por un campo.
func Snapshot(ctx context.Context, client *firestore.Client, collections []string, filterField string, filterValue interface{}) map[string]interface{} {
	state := make(map[string]interface{})
	if client == nil {
		return state
	}
	for _, collName := range collections {
		collState := make(map[string]interface{})
		q := client.Collection(collName).Query
		if filterField != "" {
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
