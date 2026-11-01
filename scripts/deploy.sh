#!/usr/bin/env bash
# Builds the production images (the app and our SearXNG), pushes them, then has Portainer recreate each container with
# its image (same as « Recreate » with « Re-pull image » in its UI). Needs PORTAINER_API_KEY: a Portainer access token
# (My account > Access tokens).
set -euo pipefail

REGISTRY=registry.jonas.bzh
PORTAINER=https://portainer.jonas.bzh
ENVIRONMENT=3

: "${PORTAINER_API_KEY:?Set PORTAINER_API_KEY to a Portainer access token}"
cd "$(dirname "$0")/.."

portainer() {
  curl -sS -m 300 -H "X-API-Key: $PORTAINER_API_KEY" -H 'content-type: application/json' -w '\n%{http_code}' "$@"
}

# deploy <container> <image> <build context>: Portainer finds the container by its name, which may differ from the
# image's (`deploy/compose.yaml` names SearXNG's with an underscore).
deploy() {
  local container=$1 context=$3
  local image="$REGISTRY/$2:latest"
  docker build --pull --platform=linux/amd64 -t "$image" "$context"
  docker push "$image"

  echo "Recreating $container with the new image…"
  # By id, never by name: Portainer renames the old container to "<name>-old" first, then a name would point to
  # nothing and the recreate (and its rollback) would fail halfway.
  local response id
  response=$(portainer "$PORTAINER/api/endpoints/$ENVIRONMENT/docker/containers/$container/json")
  if [[ ${response##*$'\n'} != 200 ]]; then
    echo "Container $container not found in Portainer: ${response%$'\n'*}" >&2
    exit 1
  fi
  id=$(printf '%s' "${response%$'\n'*}" | bun -e 'console.log((await Bun.stdin.json()).Id)')

  response=$(portainer -X POST -d '{"PullImage":true}' "$PORTAINER/api/docker/$ENVIRONMENT/containers/$id/recreate")
  if [[ ${response##*$'\n'} != 2?? ]]; then
    echo "Portainer could not recreate $container: ${response%$'\n'*}" >&2
    echo "Check in Portainer that a container named $container runs (not $container-old)." >&2
    exit 1
  fi
  echo "Done: $container runs the new image."
}

deploy open-agent_searxng open-agent-searxng searxng
deploy open-agent open-agent .
