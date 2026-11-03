#!/usr/bin/env bash
# Runs on the VM, started by the GitHub workflow:  ./deploy.sh <image>   (registry token on stdin)
# Pulls the image, restarts the app, waits for it to be healthy, and goes back to the previous
# image if it never is.
set -euo pipefail
cd "$(dirname "$0")"

IMAGE="${1:?usage: deploy.sh <image>}"
FILE=compose.prod.yaml
PREVIOUS="$(cat current_image 2>/dev/null || true)"

[ -f .env ] || { echo "Missing $(pwd)/.env"; exit 1; }

# The registry token arrives on stdin, so it never appears in a process list or a log.
if [ -n "${REGISTRY_USER:-}" ] && [ ! -t 0 ]; then
  docker login ghcr.io -u "$REGISTRY_USER" --password-stdin
fi

up() { IMAGE="$1" docker compose -f "$FILE" up -d --remove-orphans; }

healthy() {
  for _ in $(seq 1 30); do
    state="$(docker inspect --format '{{.State.Health.Status}}' "$(docker compose -f "$FILE" ps -q app)" 2>/dev/null || echo none)"
    [ "$state" = healthy ] && return 0
    sleep 3
  done
  return 1
}

echo "Deploying $IMAGE (previous: ${PREVIOUS:-none})"
IMAGE="$IMAGE" docker compose -f "$FILE" pull app
up "$IMAGE"

if healthy; then
  echo "$IMAGE" > current_image
  docker image prune -af --filter "until=72h" >/dev/null || true
  echo "Deployed."
  exit 0
fi

echo "New version did not become healthy. Last log lines:"
docker compose -f "$FILE" logs --tail 40 app || true
if [ -n "$PREVIOUS" ]; then
  echo "Rolling back to $PREVIOUS"
  up "$PREVIOUS"
fi
exit 1
