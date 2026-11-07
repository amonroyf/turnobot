package sandbox

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

func equalDocs(a, b interface{}) bool {
	// comparación simple por serialización no disponible sin encoding; usar map equality aproximada
	am, oka := a.(map[string]interface{})
	bm, okb := b.(map[string]interface{})
	if !oka || !okb {
		return a == b
	}
	if len(am) != len(bm) {
		return false
	}
	for k, v := range am {
		if bv, ok := bm[k]; !ok || !equalDocs(v, bv) {
			return false
		}
	}
	return true
}
