#!/usr/bin/env bash
# Builds an offline install bundle — for servers without internet access
#   Usage: docker/offline-bundle.sh <app image tag> <output folder> [docker volume holding Ollama models]
#   Result: <folder>/aitalk-offline-<tag>.tar.gz + .sha256 + docker-compose.yml + .env.example
#         With a volume, the Ollama image joins the bundle + ollama-models.tar.gz (the volume's whole /root/.ollama) — checksums in the same file
#   Everything is built in a temporary folder and moved only after the archive and both images are checked — an interrupted bundle never gets a checksum
# On the target server:
#   sha256sum -c aitalk-offline-*.sha256       (macOS: shasum -a 256 -c)
#   docker load -i aitalk-offline-*.tar.gz
#   cp .env.example .env  → fill in the required values (AITALK_IMAGE already holds this bundle's tag) → docker compose up -d
#   Bundle with Ollama: COMPOSE_PROFILES=ollama in .env → docker compose up -d
#     → docker compose run --rm -T --entrypoint tar ollama -C /root/.ollama -xzf - < ollama-models.tar.gz → docker compose restart ollama
set -euo pipefail
TAG=${1:?app image tag, e.g. aitalk-selfhosted:1.0.0}
OUT=${2:?output folder}
MODELS_VOLUME=${3:-}
DB_IMAGE=pgvector/pgvector:pg16
# Must match the compose default (OLLAMA_IMAGE in docker-compose.yml)
OLLAMA_IMAGE=ollama/ollama:0.35.0
IMAGES=("$TAG" "$DB_IMAGE")
if [ -n "$MODELS_VOLUME" ]; then
  docker volume inspect "$MODELS_VOLUME" >/dev/null
  docker image inspect "$OLLAMA_IMAGE" >/dev/null 2>&1 || docker pull "$OLLAMA_IMAGE"
  IMAGES+=("$OLLAMA_IMAGE")
  # Model check — before the slow save. At least one manifest file; each must parse as JSON with config + layers (one or more),
  #   and every blob it points to must exist (stops on directories only · empty · truncated manifests · half-pulled volumes). JSON is read with node on the machine building the bundle
  NEED=$(docker run --rm -v "$MODELS_VOLUME":/root/.ollama:ro --entrypoint sh "$OLLAMA_IMAGE" -c '
    cd /root/.ollama/models 2>/dev/null || exit 0
    find manifests -type f | while read -r m; do printf "%s\n" "$m"; base64 -w0 "$m"; printf "\n"; done' | node -e '
    const lines = require("fs").readFileSync(0, "utf8").split("\n").filter(Boolean)
    if (lines.length === 0) { console.error("no Ollama models (manifest files) in the volume"); process.exit(1) }
    const need = new Set()
    for (let i = 0; i < lines.length; i += 2) {
      const name = lines[i]; let m
      try { m = JSON.parse(Buffer.from(lines[i + 1] ?? "", "base64").toString("utf8")) } catch { console.error(`model ${name}: manifest is not valid JSON`); process.exit(1) }
      const digests = [m?.config?.digest, ...(Array.isArray(m?.layers) ? m.layers.map((l) => l?.digest) : [])]
      if (!m?.config?.digest || !Array.isArray(m.layers) || m.layers.length === 0 || !digests.every((d) => /^sha256:[0-9a-f]{64}$/.test(d ?? ""))) { console.error(`model ${name}: manifest has no config/layers`); process.exit(1) }
      for (const d of digests) need.add(d.slice(7))
      console.error(`model ok: ${name.replace(/^manifests\//, "")}`)
    }
    console.log([...need].join(" "))')
  docker run --rm -v "$MODELS_VOLUME":/root/.ollama:ro --entrypoint sh "$OLLAMA_IMAGE" -c '
    for d in "$@"; do [ -s "/root/.ollama/models/blobs/sha256-$d" ] || { echo "missing model blob sha256:$d" >&2; exit 1; }; done' sh $NEED
fi
NAME="aitalk-offline-$(echo "$TAG" | tr ':/' '__')"
DIR=$(cd "$(dirname "$0")/.." && pwd)
docker image inspect "$TAG" >/dev/null
docker image inspect "$DB_IMAGE" >/dev/null 2>&1 || docker pull "$DB_IMAGE"
mkdir -p "$OUT"
TMP=$(mktemp -d "$OUT/.bundle-tmp.XXXXXX")
trap 'rm -rf "$TMP"' EXIT
docker save "${IMAGES[@]}" | gzip > "$TMP/$NAME.tar.gz"
gzip -t "$TMP/$NAME.tar.gz"
# Are both images in the bundle (tag list)
# Runs on the machine building the bundle — node reads the JSON (also line-delimited) · exact string compare (-F)
TAGS=$(gzip -dc "$TMP/$NAME.tar.gz" | tar -xO manifest.json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{for(const m of JSON.parse(s))for(const t of m.RepoTags||[])console.log(t)})')
for t in "${IMAGES[@]}"; do echo "$TAGS" | grep -qxF "$t" || { echo "bundle is missing $t" >&2; exit 1; }; done
FILES=("$NAME.tar.gz")
if [ -n "$MODELS_VOLUME" ]; then
  # Model files — packed with tar from the Ollama image (no extra image needed)
  docker run --rm -v "$MODELS_VOLUME":/root/.ollama:ro --entrypoint tar "$OLLAMA_IMAGE" -C /root/.ollama -czf - . > "$TMP/ollama-models.tar.gz"
  gzip -t "$TMP/ollama-models.tar.gz"
  FILES+=("ollama-models.tar.gz")
fi
( cd "$TMP" && (command -v sha256sum >/dev/null && sha256sum "${FILES[@]}" || shasum -a 256 "${FILES[@]}") > "$NAME.sha256" )
cp "$DIR/docker/docker-compose.yml" "$TMP/"
# Write this bundle's tag into the example's image line — a plain cp .env.example .env then finds the loaded image
sed "s|^AITALK_IMAGE=.*|AITALK_IMAGE=$TAG|" "$DIR/docker/.env.example" > "$TMP/.env.example"
grep -qxF "AITALK_IMAGE=$TAG" "$TMP/.env.example"
for f in "${FILES[@]}" "$NAME.sha256" docker-compose.yml .env.example; do mv "$TMP/$f" "$OUT/"; done
echo "$OUT/$NAME.tar.gz ($(du -h "$OUT/$NAME.tar.gz" | cut -f1))"
