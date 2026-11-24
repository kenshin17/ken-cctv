#!/usr/bin/env bash
# Create or update Secret ken-cctv-secret (namespace production) on k3s from local files:
#   .env                -> TAPO_IP, TAPO_USER, TAPO_PASS, EZTV_RTSP_URL, EZTV_RTSP_SUB_URL
#   go2rtc/go2rtc.yaml  -> XIAOMI_USER_ID, XIAOMI_TOKEN (the `xiaomi:` block written after
#                          logging in via go2rtc Web UI > Add > Xiaomi)
#
# Usage:
#   scripts/k8s-secret.sh --dry-run                 # print the Secret with values masked, touch nothing
#   KUBECTL="ssh pi5 kubectl" scripts/k8s-secret.sh # apply via the k3s server over ssh
#   KUBECONFIG=~/.kube/k3s.yaml scripts/k8s-secret.sh
#   add --yes to skip the confirmation prompt
#
# Write TAPO_USER/TAPO_PASS in .env as plain text: they are percent-encoded here.
# Tapo/EZTV values may be left empty in .env: those streams just stay offline.
# Re-run any time a password or the Xiaomi token changes; go2rtc is restarted to pick it up.
set -euo pipefail
cd "$(dirname "$0")/.."

NS=production
NAME=ken-cctv-secret
# kubectl used to talk to the cluster; the Secret YAML itself is rendered locally (client-side)
read -r -a KUBECTL <<<"${KUBECTL:-kubectl}"
DRY_RUN=false
YES=false
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    --yes) YES=true ;;
    *) echo "unknown option: $arg" >&2; exit 1 ;;
  esac
done

[[ -f .env ]] || { echo "missing .env (copy .env.example and fill it in)" >&2; exit 1; }
[[ -f go2rtc/go2rtc.yaml ]] || { echo "missing go2rtc/go2rtc.yaml with the xiaomi: block" >&2; exit 1; }

get_env() { grep -E "^$1=" .env | head -1 | cut -d= -f2-; }

# Tapo user/pass are inserted into rtsp://USER:PASS@... by go2rtc, so percent-encode them
# (a raw @ : / # ? % in the password breaks the URL). EZTV_RTSP_URL is used as-is.
urlencode() { python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$1"; }

TAPO_IP=$(get_env TAPO_IP)
TAPO_USER=$(urlencode "$(get_env TAPO_USER)")
TAPO_PASS=$(urlencode "$(get_env TAPO_PASS)")
EZTV_RTSP_URL=$(get_env EZTV_RTSP_URL)
EZTV_RTSP_SUB_URL=$(get_env EZTV_RTSP_SUB_URL)

# First "key: value" line under the top-level `xiaomi:` block
XIAOMI_LINE=$(awk '/^xiaomi:/{f=1;next} f&&/^[^ ]/{exit} f&&/:/{print;exit}' go2rtc/go2rtc.yaml)
XIAOMI_USER_ID=$(sed -E 's/^ *"?([0-9]+)"?:.*/\1/' <<<"$XIAOMI_LINE")
XIAOMI_TOKEN=$(sed -E 's/^ *"?[0-9]+"?: *"?([^"]*)"? *$/\1/' <<<"$XIAOMI_LINE")

if [[ -z "$XIAOMI_USER_ID" || "$XIAOMI_TOKEN" != V1:* ]]; then
  echo "no valid xiaomi: block in go2rtc/go2rtc.yaml (log in via go2rtc Web UI > Add > Xiaomi)" >&2
  exit 1
fi
for v in TAPO_IP TAPO_USER TAPO_PASS EZTV_RTSP_URL EZTV_RTSP_SUB_URL; do
  [[ -n "${!v}" ]] || echo "warning: $v is empty, that camera will stay offline" >&2
done

secret_yaml() {
  kubectl create secret generic "$NAME" -n "$NS" \
    --from-literal=TAPO_IP="$TAPO_IP" \
    --from-literal=TAPO_USER="$TAPO_USER" \
    --from-literal=TAPO_PASS="$TAPO_PASS" \
    --from-literal=EZTV_RTSP_URL="$EZTV_RTSP_URL" \
    --from-literal=EZTV_RTSP_SUB_URL="$EZTV_RTSP_SUB_URL" \
    --from-literal=XIAOMI_USER_ID="$XIAOMI_USER_ID" \
    --from-literal=XIAOMI_TOKEN="$XIAOMI_TOKEN" \
    --dry-run=client -o yaml
}

if $DRY_RUN; then
  secret_yaml | sed -E 's/^(  [A-Z_]+: ).*/\1<set>/'
  exit 0
fi

TARGET="${KUBECTL[*]} (context: $("${KUBECTL[@]}" config current-context))"
if ! $YES; then
  read -r -p "Apply $NS/$NAME via $TARGET? [y/N] " ok
  [[ "$ok" == [yY] ]] || { echo "aborted"; exit 1; }
fi

secret_yaml | "${KUBECTL[@]}" apply -f -
if "${KUBECTL[@]}" -n "$NS" get deploy go2rtc >/dev/null 2>&1; then
  "${KUBECTL[@]}" -n "$NS" rollout restart deploy/go2rtc
fi
