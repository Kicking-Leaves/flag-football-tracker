#!/usr/bin/env bash
# One-time setup of RouteRunnr film infrastructure in its own Google Cloud project.
# Safe to re-run: each step skips what already exists.
#
#   PROJECT_ID=routerunnr-123 SUPABASE_URL=https://<ref>.supabase.co \
#   SUPABASE_SERVICE_ROLE_KEY=... infra/film/setup.sh
#
# The service role key is stored in Secret Manager; it is never written to the repo.
set -euo pipefail

: "${PROJECT_ID:?set PROJECT_ID}"
: "${SUPABASE_URL:?set SUPABASE_URL}"
REGION="${REGION:-us-west1}"
BUCKET="${BUCKET:-${PROJECT_ID}-film}"
SA_NAME="routerunnr-film"
SA="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
REPO="film"
JOB="film-worker"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}/${JOB}:$(git rev-parse --short HEAD)"
HERE="$(cd "$(dirname "$0")" && pwd)"
gc() { gcloud --project "$PROJECT_ID" --quiet "$@"; }

echo "== APIs"
gc services enable run.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com \
  drive.googleapis.com iamcredentials.googleapis.com secretmanager.googleapis.com storage.googleapis.com

echo "== Service account $SA"
gc iam service-accounts describe "$SA" >/dev/null 2>&1 ||
  gc iam service-accounts create "$SA_NAME" --display-name "RouteRunnr film (worker + app)"
# New accounts take a few seconds to become usable in IAM bindings.
for _ in $(seq 1 30); do
  gc iam service-accounts get-iam-policy "$SA" >/dev/null 2>&1 && break
  sleep 5
done
# The worker signs its own read links for ffmpeg (signBlob on itself).
for attempt in 1 2 3 4 5 6; do
  gc iam service-accounts add-iam-policy-binding "$SA" --member "serviceAccount:$SA" \
    --role roles/iam.serviceAccountTokenCreator >/dev/null && break
  [ "$attempt" = 6 ] && exit 1
  sleep 10
done

echo "== Bucket gs://$BUCKET"
gcloud storage buckets describe "gs://$BUCKET" --project "$PROJECT_ID" >/dev/null 2>&1 ||
  gcloud storage buckets create "gs://$BUCKET" --project "$PROJECT_ID" --location "$REGION" \
    --uniform-bucket-level-access --public-access-prevention
gcloud storage buckets update "gs://$BUCKET" --lifecycle-file "$HERE/lifecycle.json"
gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" --member "serviceAccount:$SA" \
  --role roles/storage.objectAdmin >/dev/null

echo "== Secret: Supabase service role key"
if ! gc secrets describe supabase-service-role-key >/dev/null 2>&1; then
  : "${SUPABASE_SERVICE_ROLE_KEY:?set SUPABASE_SERVICE_ROLE_KEY for the first run}"
  printf %s "$SUPABASE_SERVICE_ROLE_KEY" | gc secrets create supabase-service-role-key --data-file=-
fi
gc secrets add-iam-policy-binding supabase-service-role-key --member "serviceAccount:$SA" \
  --role roles/secretmanager.secretAccessor >/dev/null

echo "== Image $IMAGE"
gc artifacts repositories describe "$REPO" --location "$REGION" >/dev/null 2>&1 ||
  gc artifacts repositories create "$REPO" --location "$REGION" --repository-format docker
gc builds submit "$HERE/../../film-worker" --region "$REGION" --tag "$IMAGE"

echo "== Cloud Run job $JOB"
gc run jobs deploy "$JOB" --region "$REGION" --image "$IMAGE" --service-account "$SA" \
  --cpu 8 --memory 16Gi --task-timeout 6h --max-retries 0 \
  --set-env-vars "SUPABASE_URL=$SUPABASE_URL,FILM_BUCKET=$BUCKET" \
  --set-secrets "SUPABASE_SERVICE_ROLE_KEY=supabase-service-role-key:latest"
# The app (same service account) starts executions with per-camera arguments.
gc run jobs add-iam-policy-binding "$JOB" --region "$REGION" --member "serviceAccount:$SA" \
  --role roles/run.jobsExecutorWithOverrides >/dev/null

cat <<DONE

Done. Vercel needs these environment variables:
  FILM_GCP_PROJECT=$PROJECT_ID
  FILM_GCP_REGION=$REGION
  FILM_BUCKET=$BUCKET
  FILM_JOB_NAME=$JOB
  FILM_GCP_SA_KEY=<base64 of a key for $SA>
Drive folders are shared with: $SA
DONE
