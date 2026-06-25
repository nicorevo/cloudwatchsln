#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")"

CONFIG_ENV="${CONFIG_ENV:-prod}"
CONFIG_FILE="${CONFIG_FILE:-config.${CONFIG_ENV}.json}"
export CONFIG_ENV CONFIG_FILE

log() {
    printf '%s\n' "$*"
}

fail() {
    printf 'ERRORE: %s\n' "$*" >&2
    exit 1
}

log "Avvio CloudWatch Log Downloader (${CONFIG_FILE})..."

if ! command -v node >/dev/null 2>&1; then
    fail "Node.js non trovato"
fi

if [ ! -f "$CONFIG_FILE" ]; then
    fail "$CONFIG_FILE non trovato. Monta la config nel container o copia config.sample.json."
fi

if [ ! -d "node_modules" ]; then
    if ! command -v npm >/dev/null 2>&1; then
        fail "node_modules assente e npm non trovato"
    fi

    log "Dipendenze assenti: eseguo npm install..."
    npm install
fi

./setup-sso.sh --silent

exec node src/index.js
