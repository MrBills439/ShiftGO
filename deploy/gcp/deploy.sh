#!/usr/bin/env bash
# Deploy ShiftGO to Google Cloud (Cloud Run + Cloud SQL), London region.
#
# Run it from Google Cloud Shell (already signed in), at the repository root:
#   ./deploy/gcp/deploy.sh                    first install, and every update
#   ./deploy/gcp/deploy.sh create-agency --name "Acme Care" --hr-email hr@acme.example --hr-name "Jo Smith"
#   ./deploy/gcp/deploy.sh status             URLs and health
#   ./deploy/gcp/deploy.sh audit-shift-times  read-only report on stored shift times
#
# Safe to run again: anything that already exists is kept or updated.
# Settings (environment variables, all optional):
#   PROJECT_ID   default: pipcord
#   REGION       default: europe-west2 (London)
#   EMAIL_FROM   sender for invitations and password-reset codes, e.g.
#                EMAIL_FROM="LeafRota <noreply@leafrota.co.uk>" (the domain must
#                be verified in Resend). REQUIRED on the first deploy. After
#                that it is optional: without it, the sender already configured
#                on the running API is kept, so a redeploy never resets it.
#                Set it only to change the sender.
# See deploy/gcp/README.md.
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-pipcord}"
REGION="${REGION:-europe-west2}"
EMAIL_FROM_OVERRIDE="${EMAIL_FROM:-}"
EMAIL_FROM=""

REPO=shiftgo
SQL_INSTANCE=shiftgo-db
DB_NAME=shiftgo
DB_USER=shiftgo
API_SERVICE=shiftgo-api
WEB_SERVICE=shiftgo-web
MIGRATE_JOB=shiftgo-migrate
ADMIN_JOB=shiftgo-admin
SA_NAME=shiftgo-run
BUCKET="${PROJECT_ID}-shiftgo-uploads"

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
log()  { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m!! %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31mxx %s\033[0m\n' "$*" >&2; exit 1; }
rand() { openssl rand -hex 32; }

# ── project / derived names ────────────────────────────────────────────────
init() {
  command -v gcloud >/dev/null || die "gcloud not found. Run this in Google Cloud Shell."
  gcloud projects describe "$PROJECT_ID" >/dev/null 2>&1 || {
    warn "Project '$PROJECT_ID' not found or not accessible. Your projects:"
    gcloud projects list --format="table(projectId,name)"
    die "Re-run with PROJECT_ID=<project id from the list>"
  }
  gcloud config set project "$PROJECT_ID" >/dev/null
  PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
  SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
  AR="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}"
  SQL_CONN="${PROJECT_ID}:${REGION}:${SQL_INSTANCE}"
  # Cloud Run's stable URL format: https://SERVICE-PROJECT_NUMBER.REGION.run.app
  API_URL="https://${API_SERVICE}-${PROJECT_NUMBER}.${REGION}.run.app"
  WEB_URL="https://${WEB_SERVICE}-${PROJECT_NUMBER}.${REGION}.run.app"
  TAG="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || date +%Y%m%d%H%M%S)-$(date +%s)"
}

# A sender is "Name <address>" or a bare address; '~' is reserved (see api_env).
valid_sender() {
  local re_addr='[^@<>[:space:]~]+@[^@<>[:space:]~]+\.[^@<>[:space:]~]+'
  [[ "$1" =~ ^[^\<\>~]+\ \<${re_addr}\>$ || "$1" =~ ^${re_addr}$ ]]
}

# Read EMAIL_FROM from the deployed API service. Sets:
#   API_EXISTS        yes | no
#   CURRENT_FROM      the plain value ("" if unset)
#   CURRENT_FROM_KIND value | secret | none
# Stops (changing nothing) if the service can't be read for any reason other
# than "it doesn't exist yet".
read_current_email_from() {
  local out err rc
  err="$(mktemp)"
  # (if/else so `set -e` doesn't exit before we can look at the error)
  if out="$(gcloud run services describe "$API_SERVICE" --region="$REGION" --format=json 2>"$err")"; then rc=0; else rc=$?; fi
  if [ $rc -ne 0 ]; then
    if grep -qiE "not found|could not be found|NOT_FOUND" "$err"; then
      API_EXISTS=no; CURRENT_FROM=""; CURRENT_FROM_KIND=none; rm -f "$err"; return
    fi
    cat "$err" >&2; rm -f "$err"
    die "Couldn't read the current $API_SERVICE service to keep its email sender. Nothing was changed."
  fi
  rm -f "$err"
  API_EXISTS=yes
  local parsed
  parsed="$(printf '%s' "$out" | python3 -c 'import json,sys
d=json.load(sys.stdin)
for c in d.get("spec",{}).get("template",{}).get("spec",{}).get("containers",[]):
  for e in c.get("env",[]) or []:
    if e.get("name")=="EMAIL_FROM":
      print("secret" if "valueFrom" in e else "value"); print(e.get("value","")); sys.exit(0)
print("none"); print("")')" || die "Couldn't parse the $API_SERVICE service settings. Nothing was changed."
  CURRENT_FROM_KIND="$(printf '%s\n' "$parsed" | sed -n 1p)"
  CURRENT_FROM="$(printf '%s\n' "$parsed" | sed -n 2p)"
}

# Decide the sender for this deploy: explicit override > what production has.
resolve_email_from() {
  read_current_email_from
  if [ "$CURRENT_FROM_KIND" = secret ]; then
    die "EMAIL_FROM on $API_SERVICE is set from a Secret Manager secret. This script manages it as a plain setting
   and won't overwrite a secret-backed one. Remove that secret mapping in Cloud Run (or keep managing it there), then rerun.
   Nothing was changed."
  fi
  if [ -n "$EMAIL_FROM_OVERRIDE" ]; then
    valid_sender "$EMAIL_FROM_OVERRIDE" || die "EMAIL_FROM is not a valid sender: use \"Name <address@domain>\" or address@domain."
    EMAIL_FROM="$EMAIL_FROM_OVERRIDE"
    echo "   Email sender (set by you): $EMAIL_FROM"
    [ -n "$CURRENT_FROM" ] && [ "$CURRENT_FROM" != "$EMAIL_FROM" ] && echo "   (replacing: $CURRENT_FROM)"
  else
    EMAIL_FROM="$CURRENT_FROM"
    if [ -z "$EMAIL_FROM" ]; then
      if [ "$API_EXISTS" = yes ]; then
        die "$API_SERVICE has no EMAIL_FROM set. Run with EMAIL_FROM=\"LeafRota <noreply@yourdomain>\" to set it. Nothing was changed."
      fi
      die 'No email sender configured yet. For the first deploy run:
     EMAIL_FROM="LeafRota <noreply@yourdomain>" ./deploy/gcp/deploy.sh
   (the domain must be verified in Resend).'
    fi
    valid_sender "$EMAIL_FROM" || die "The deployed EMAIL_FROM is not a valid sender. Set EMAIL_FROM explicitly to fix it."
    echo "   Email sender (kept from the running API): $EMAIL_FROM"
  fi
  echo "   Applied to: $API_SERVICE (API), $ADMIN_JOB (invitations from create-agency), $MIGRATE_JOB"
  case "$EMAIL_FROM" in *@resend.dev*)
    warn "Resend's test sender only delivers to your own Resend account address." ;;
  esac
}

secret_exists() { gcloud secrets describe "$1" >/dev/null 2>&1; }
put_secret() {   # name value  (adds a version only when the secret is new)
  if secret_exists "$1"; then return; fi
  printf '%s' "$2" | gcloud secrets create "$1" --replication-policy=user-managed --locations="$REGION" --data-file=- >/dev/null
  echo "   created secret $1"
}
secret_value() { gcloud secrets versions access latest --secret="$1"; }

# ── one-off infrastructure ─────────────────────────────────────────────────
setup_infra() {
  log "Checking billing"
  gcloud services enable cloudbilling.googleapis.com >/dev/null
  [ "$(gcloud billing projects describe "$PROJECT_ID" --format='value(billingEnabled)' 2>/dev/null)" = "True" ] \
    || die "Billing is not enabled on '$PROJECT_ID'. Link a billing account: console.cloud.google.com/billing"

  log "Enabling Google Cloud APIs (first time takes a minute)"
  gcloud services enable run.googleapis.com sqladmin.googleapis.com artifactregistry.googleapis.com \
    cloudbuild.googleapis.com secretmanager.googleapis.com cloudscheduler.googleapis.com \
    storage.googleapis.com iam.googleapis.com >/dev/null

  log "Letting Cloud Build push images"
  # New projects run builds as the Compute Engine default service account,
  # which may have no permissions. Grants are no-ops when already present.
  local build_sa="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
  for role in roles/artifactregistry.writer roles/logging.logWriter roles/storage.objectViewer; do
    gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:${build_sa}" --role="$role" --condition=None >/dev/null 2>&1 || true
  done

  log "Image registry"
  gcloud artifacts repositories describe "$REPO" --location="$REGION" >/dev/null 2>&1 \
    || gcloud artifacts repositories create "$REPO" --repository-format=docker --location="$REGION" --description="ShiftGO images"

  log "Service account for the app"
  gcloud iam service-accounts describe "$SA_EMAIL" >/dev/null 2>&1 \
    || gcloud iam service-accounts create "$SA_NAME" --display-name="ShiftGO Cloud Run"
  for role in roles/cloudsql.client roles/secretmanager.secretAccessor; do
    gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:${SA_EMAIL}" --role="$role" --condition=None >/dev/null
  done

  log "Database (Cloud SQL Postgres 16). A new instance takes about 10 minutes"
  if ! gcloud sql instances describe "$SQL_INSTANCE" >/dev/null 2>&1; then
    gcloud sql instances create "$SQL_INSTANCE" --database-version=POSTGRES_16 --edition=ENTERPRISE \
      --tier=db-f1-micro --region="$REGION" --availability-type=zonal \
      --storage-type=SSD --storage-size=10 --storage-auto-increase \
      --backup-start-time=02:00 --retained-backups-count=7 \
      --enable-point-in-time-recovery --retained-transaction-log-days=7
  fi
  gcloud sql databases describe "$DB_NAME" --instance="$SQL_INSTANCE" >/dev/null 2>&1 \
    || gcloud sql databases create "$DB_NAME" --instance="$SQL_INSTANCE"
  if ! secret_exists shiftgo-database-url; then
    local pw; pw="$(rand)"
    if gcloud sql users list --instance="$SQL_INSTANCE" --format='value(name)' | grep -qx "$DB_USER"; then
      gcloud sql users set-password "$DB_USER" --instance="$SQL_INSTANCE" --password="$pw"
    else
      gcloud sql users create "$DB_USER" --instance="$SQL_INSTANCE" --password="$pw"
    fi
    put_secret shiftgo-database-url "postgresql://${DB_USER}:${pw}@localhost/${DB_NAME}?host=/cloudsql/${SQL_CONN}&connection_limit=5"
  fi

  log "File storage (private bucket for photos and right-to-work documents)"
  if ! gcloud storage buckets describe "gs://${BUCKET}" >/dev/null 2>&1; then
    gcloud storage buckets create "gs://${BUCKET}" --location="$REGION" \
      --uniform-bucket-level-access --public-access-prevention
    gcloud storage buckets update "gs://${BUCKET}" --versioning
  fi
  gcloud storage buckets add-iam-policy-binding "gs://${BUCKET}" \
    --member="serviceAccount:${SA_EMAIL}" --role=roles/storage.objectAdmin >/dev/null

  log "Secrets"
  put_secret shiftgo-better-auth-secret "$(rand)"
  put_secret shiftgo-web-proxy-secret "$(rand)"
  put_secret shiftgo-jobs-secret "$(rand)"
  if ! secret_exists shiftgo-resend-api-key; then
    echo "   Invitations and password-reset codes are sent with Resend (resend.com)."
    echo "   Create an API key there, then paste it here (it is not shown and goes"
    echo "   straight into Google Secret Manager):"
    local key=""
    while [ -z "$key" ]; do read -r -s -p "   Resend API key: " key; echo; done
    put_secret shiftgo-resend-api-key "$key"
  fi
}

# ── build ──────────────────────────────────────────────────────────────────
build_images() {
  log "Building the API image (Cloud Build)"
  gcloud builds submit "$ROOT/backend" --region="$REGION" --tag="${AR}/api:${TAG}"
  log "Building the web image (Cloud Build), pointed at $API_URL"
  gcloud builds submit "$ROOT/web" --region="$REGION" --config="$ROOT/deploy/gcp/cloudbuild-web.yaml" \
    --substitutions="_IMAGE=${AR}/web:${TAG},_API_PROXY_TARGET=${API_URL}"
}

# Same settings for the API service and the one-off jobs (production config
# refuses to start without them).
api_env() {
  # '~' separates the settings because EMAIL_FROM contains '@' and spaces.
  # "update" (not "set") keeps any settings added by hand on the service,
  # e.g. FIREBASE_* secrets, instead of wiping them on every deploy.
  echo "--update-env-vars=^~^NODE_ENV=production~UPLOAD_DIR=/app/uploads~BETTER_AUTH_URL=${API_URL}~WEB_APP_URL=${WEB_URL}~CORS_ORIGINS=${WEB_URL}~EMAIL_FROM=${EMAIL_FROM}~RUN_SCHEDULER=false~TRUST_PROXY_HOPS=1"
  echo "--update-secrets=DATABASE_URL=shiftgo-database-url:latest,BETTER_AUTH_SECRET=shiftgo-better-auth-secret:latest,WEB_PROXY_SECRET=shiftgo-web-proxy-secret:latest,JOBS_SECRET=shiftgo-jobs-secret:latest,RESEND_API_KEY=shiftgo-resend-api-key:latest"
}

# ── deploy ─────────────────────────────────────────────────────────────────
deploy_all() {
  local env_flags; mapfile -t env_flags < <(api_env)

  log "Database migrations"
  gcloud run jobs deploy "$MIGRATE_JOB" --image="${AR}/api:${TAG}" --region="$REGION" \
    --service-account="$SA_EMAIL" --set-cloudsql-instances="$SQL_CONN" \
    --command=npx --args=prisma,migrate,deploy "${env_flags[@]}" \
    --max-retries=0 --task-timeout=600s --execute-now --wait

  log "Admin job (used by 'create-agency')"
  gcloud run jobs deploy "$ADMIN_JOB" --image="${AR}/api:${TAG}" --region="$REGION" \
    --service-account="$SA_EMAIL" --set-cloudsql-instances="$SQL_CONN" \
    --command=node --args=scripts/createAgency.js,--help "${env_flags[@]}" \
    --max-retries=0 --task-timeout=300s

  log "API service"
  gcloud run deploy "$API_SERVICE" --image="${AR}/api:${TAG}" --region="$REGION" \
    --service-account="$SA_EMAIL" --add-cloudsql-instances="$SQL_CONN" \
    --execution-environment=gen2 \
    --add-volume=name=uploads,type=cloud-storage,bucket="$BUCKET" \
    --add-volume-mount=volume=uploads,mount-path=/app/uploads \
    "${env_flags[@]}" \
    --port=4000 --cpu=1 --memory=512Mi --min-instances=0 --max-instances=3 \
    --concurrency=80 --timeout=300 --allow-unauthenticated

  log "Web app"
  gcloud run deploy "$WEB_SERVICE" --image="${AR}/web:${TAG}" --region="$REGION" \
    --service-account="$SA_EMAIL" \
    --update-env-vars=TRUSTED_PROXY_HOPS=1 \
    --update-secrets=WEB_PROXY_SECRET=shiftgo-web-proxy-secret:latest \
    --port=3000 --cpu=1 --memory=512Mi --min-instances=0 --max-instances=3 \
    --allow-unauthenticated

  log "Background jobs (Cloud Scheduler calls the API)"
  local jobs_secret; jobs_secret="$(secret_value shiftgo-jobs-secret)"
  local spec name schedule
  for spec in "attendance|* * * * *" "missedClockIn|*/5 * * * *" \
              "fixedWorkPatternGeneration|30 2 * * *" "retention|15 3 * * *"; do
    name="${spec%%|*}"; schedule="${spec#*|}"
    local verb=create
    gcloud scheduler jobs describe "shiftgo-${name}" --location="$REGION" >/dev/null 2>&1 && verb=update
    if [ "$verb" = create ]; then
      gcloud scheduler jobs create http "shiftgo-${name}" --location="$REGION" \
        --schedule="$schedule" --time-zone=UTC --http-method=POST \
        --uri="${API_URL}/internal/jobs/${name}" --headers="X-Jobs-Secret=${jobs_secret}" \
        --attempt-deadline=300s --max-retry-attempts=0 >/dev/null
    else
      gcloud scheduler jobs update http "shiftgo-${name}" --location="$REGION" \
        --schedule="$schedule" --time-zone=UTC --http-method=POST \
        --uri="${API_URL}/internal/jobs/${name}" --update-headers="X-Jobs-Secret=${jobs_secret}" \
        --attempt-deadline=300s --max-retry-attempts=0 >/dev/null
    fi
    echo "   shiftgo-${name}: ${schedule}"
  done
}

status() {
  log "ShiftGO on Google Cloud ($PROJECT_ID, $REGION)"
  echo "   Web app: $WEB_URL"
  echo "   API:     $API_URL   (put this in mobile/eas.json as EXPO_PUBLIC_API_URL)"
  echo "   API health: $(curl -fsS "${API_URL}/health" 2>&1 || true)"
  echo "   Web -> API: $(curl -fsS "${WEB_URL}/api/health" 2>&1 || true)"
}

create_agency() {
  [ "$#" -gt 0 ] || die 'Usage: deploy.sh create-agency --name "Acme Care" --hr-email hr@acme.example --hr-name "Jo Smith" [--dry-run]'
  local args="scripts/createAgency.js" a
  for a in "$@"; do
    case "$a" in *"|"*) die "Values may not contain '|'";; esac
    case "$a" in *"~"*) die "Values may not contain '~'";; esac
    args="${args}|${a}"
  done
  log "Creating agency (runs inside Google Cloud, next to the database)"
  gcloud run jobs execute "$ADMIN_JOB" --region="$REGION" --args="^|^${args}" --wait
  echo "   Output: Cloud Console -> Cloud Run -> Jobs -> ${ADMIN_JOB} -> latest execution -> Logs"
}

main() {
  init
  case "${1:-deploy}" in
    deploy) log "Email sender"; resolve_email_from; setup_infra; build_images; deploy_all; status
            log "Done. Next: ./deploy/gcp/deploy.sh create-agency --name \"...\" --hr-email you@example.com --hr-name \"Your Name\"";;
    status) status;;
    create-agency) shift; create_agency "$@";;
    audit-shift-times) log "Read-only shift time audit (output in the job's logs)"
      gcloud run jobs execute "$ADMIN_JOB" --region="$REGION" --args=scripts/auditShiftTimes.js --wait
      echo "   Results: Cloud Console -> Cloud Run -> Jobs -> ${ADMIN_JOB} -> latest execution -> Logs";;
    *) die "Unknown command '$1' (deploy | status | create-agency | audit-shift-times)";;
  esac
}
main "$@"
