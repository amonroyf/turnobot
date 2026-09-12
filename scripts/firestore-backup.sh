#!/bin/bash
# Firestore Automated Backup Script
# Ejecutar diariamente via Cloud Scheduler o cron
#
# Uso:
#   ./scripts/firestore-backup.sh
#
# Requiere:
#   - gcloud autenticado
#   - Projecto GCP configurado

set -euo pipefail

PROJECT="stalwart-coast-439901-d0"
BACKUP_BUCKET="gs://${PROJECT}-firestore-backups"
INSTANCE="(default)"

echo "🔄 Iniciando backup de Firestore..."

# Crear bucket si no existe
gsutil mb -p "$PROJECT" -l us-central1 "$BACKUP_BUCKET" 2>/dev/null || true

# Ejecutar exportación
gcloud firestore export "$BACKUP_BUCKET" \
  --project="$PROJECT" \
  --database="$INSTANCE" \
  --async

echo "✅ Backup iniciado. Verificar en: $BACKUP_BUCKET"
echo "📊 Estado: gcloud firestore export list --project=$PROJECT"
