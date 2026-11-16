package sandbox

import "reflect"

// Delta calcula diferencias entre dos snapshots de Firestore.
func Delta(before, after map[string]interface{}) map[string]interface{} {
	result := make(map[string]interface{})
	for coll, afterDocs := range after {
		beforeDocs, _ := before[coll].(map[string]interface{})
		if beforeDocs == nil {
			beforeDocs = map[string]interface{}{}
		}
		afterMap := afterDocs.(map[string]interface{})
		collDelta := make(map[string]interface{})
		// added / modified
		for id, afterDoc := range afterMap {
			if beforeDoc, ok := beforeDocs[id]; ok {
				if !equalDocs(beforeDoc, afterDoc) {
					collDelta[id] = map[string]interface{}{"status": "modified", "before": beforeDoc, "after": afterDoc}
				}
			} else {
				collDelta[id] = map[string]interface{}{"status": "added", "after": afterDoc}
			}
		}
		// removed
		for id, beforeDoc := range beforeDocs {
			if _, ok := afterMap[id]; !ok {
				collDelta[id] = map[string]interface{}{"status": "removed", "before": beforeDoc}
			}
		}
		result[coll] = collDelta
	}
	return result
}

// equalDocs compara dos valores de Firestore en profundidad.
//
// Antes usaba `a == b` para los valores no-map, lo que entraba en panic con
// tipos no comparables (slices). Los docs de Turnobot tienen arrays
// (`turnos`, `servicios_ids`, `participantes`), así que el harness crasheaba
// justo cuando había algo interesante que reportar.
//
// reflect.DeepEqual maneja maps, slices, punteros y valores escalares sin
// panic. Ojo: los valores `time.Time` de Firestore llegan como
// time.Time, no como string, así que la comparación es exacta.
func equalDocs(a, b interface{}) bool {
	return reflect.DeepEqual(a, b)
}
