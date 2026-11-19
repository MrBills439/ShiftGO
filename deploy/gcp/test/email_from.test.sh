#!/usr/bin/env bash
# Tests deploy.sh's email-sender handling against a stand-in `gcloud`.
#   bash deploy/gcp/test/email_from.test.sh
# Nothing here talks to Google Cloud.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/bin"
SECRET_SENTINEL="sk_should_never_be_printed_123"

cat > "$WORK/bin/gcloud" <<STUB
#!/usr/bin/env bash
echo "gcloud \$*" >> "$WORK/calls.log"
case "\$*" in
  "projects describe pipcord --format=value(projectNumber)") echo 123456789012 ;;
  *"run services describe shiftgo-api"*"--format=json"*)
    [ -f "$WORK/service.json" ] && cat "$WORK/service.json" || exit 1 ;;
  *"billing projects describe"*) echo True ;;
  *"secrets versions access"*) echo "$SECRET_SENTINEL" ;;
  *"sql users list"*) echo shiftgo ;;
esac
exit 0
STUB
printf '#!/bin/sh\necho ok\n' > "$WORK/bin/curl"
printf '#!/bin/sh\necho abc1234\n' > "$WORK/bin/git"
chmod +x "$WORK/bin/"*

pass=0; fail=0
check() { if eval "$2"; then pass=$((pass+1)); echo "ok   - $1"; else fail=$((fail+1)); echo "FAIL - $1"; fi; }
run() {  # run deploy.sh with optional EMAIL_FROM, capture output
  rm -f "$WORK/calls.log"; : > "$WORK/calls.log"
  ( cd "$ROOT" && env PATH="$WORK/bin:$PATH" ${1:+EMAIL_FROM="$1"} bash deploy/gcp/deploy.sh ) > "$WORK/out.log" 2>&1
  echo $? > "$WORK/status"
}
service_with_sender() {
  cat > "$WORK/service.json" <<JSON
{"spec":{"template":{"spec":{"containers":[{"env":[
  {"name":"NODE_ENV","value":"production"},
  {"name":"EMAIL_FROM","value":"$1"},
  {"name":"RESEND_API_KEY","valueFrom":{"secretKeyRef":{"name":"shiftgo-resend-api-key","key":"latest"}}}
]}]}}}}
JSON
}

# 1. First deploy without a sender: stop before changing anything.
rm -f "$WORK/service.json"; run ""
check "first deploy without EMAIL_FROM fails" '[ "$(cat $WORK/status)" != 0 ]'
check "...and says how to set it" 'grep -q "For the first deploy run" "$WORK/out.log"'
check "...and changes nothing in Google Cloud" '! grep -qE "services enable|run deploy|sql instances create" "$WORK/calls.log"'

# 2. Redeploy: keep the production sender.
service_with_sender "LeafRota <noreply@leafrota.co.uk>"; run ""
check "redeploy succeeds" '[ "$(cat $WORK/status)" = 0 ]'
check "...keeps the deployed sender on the API" 'grep "run deploy shiftgo-api" "$WORK/calls.log" | grep -q "EMAIL_FROM=LeafRota <noreply@leafrota.co.uk>"'
check "...and on the admin job (invitations)" 'grep "run jobs deploy shiftgo-admin" "$WORK/calls.log" | grep -q "EMAIL_FROM=LeafRota <noreply@leafrota.co.uk>"'
check "...never falls back to the Resend test sender" '! grep -q "resend.dev" "$WORK/calls.log"'
check "...uses update (not set), so hand-added settings survive" '! grep -qE -- "--set-(env-vars|secrets)" "$WORK/calls.log"'
check "...never prints secret values" '! grep -q "$SECRET_SENTINEL" "$WORK/out.log"'

# 3. Explicit override wins.
service_with_sender "LeafRota <noreply@leafrota.co.uk>"; run "LeafRota Support <support@leafrota.co.uk>"
check "explicit EMAIL_FROM overrides the deployed one" 'grep "run deploy shiftgo-api" "$WORK/calls.log" | grep -q "EMAIL_FROM=LeafRota Support <support@leafrota.co.uk>"'

# 4. Invalid sender is refused.
run "not an email"
check "invalid EMAIL_FROM is refused" '[ "$(cat $WORK/status)" != 0 ] && grep -q "not a valid sender" "$WORK/out.log"'
check "...before changing anything" '! grep -q "run deploy" "$WORK/calls.log"'

# 5. Resend test sender: allowed, with a warning.
rm -f "$WORK/service.json"; run "LeafRota <onboarding@resend.dev>"
check "test sender warns" 'grep -q "only delivers to your own Resend account" "$WORK/out.log"'

echo "# pass $pass"; echo "# fail $fail"
[ "$fail" = 0 ]
