#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")"

CONFIG_ENV="${CONFIG_ENV:-prod}"
CONFIG_FILE="${CONFIG_FILE:-config.${CONFIG_ENV}.json}"
SSO_LOGIN_MODE="${AWS_SSO_LOGIN_MODE:-auto}"
QUIET="${SETUP_SSO_QUIET:-0}"

for arg in "$@"; do
    case "$arg" in
        --silent|--quiet)
            QUIET=1
            ;;
        --no-login)
            SSO_LOGIN_MODE=never
            ;;
        --login)
            SSO_LOGIN_MODE=always
            ;;
        --help)
            cat <<'USAGE'
Usage: ./setup-sso.sh [--silent] [--no-login] [--login]

Environment:
  CONFIG_ENV              Defaults to prod.
  CONFIG_FILE             Defaults to config.${CONFIG_ENV}.json.
  AWS_SSO_LOGIN_MODE      auto | always | never. Defaults to auto.
  AWS_SSO_NO_BROWSER      When 1, runs aws sso login with --no-browser.
USAGE
            exit 0
            ;;
    esac
done

log() {
    if [ "$QUIET" != "1" ]; then
        printf '%s\n' "$*"
    fi
}

fail() {
    printf 'ERRORE: %s\n' "$*" >&2
    exit 1
}

require_file() {
    local file="$1"
    [ -f "$file" ] || fail "file richiesto non trovato: $file"
}

require_executable() {
    local file="$1"
    [ -x "$file" ] || fail "file richiesto non eseguibile: $file"
}

read_config_value() {
    local expression="$1"
    node -e "
const fs = require('fs');
const config = JSON.parse(fs.readFileSync(process.env.CONFIG_FILE, 'utf8'));
const value = ${expression};
if (value !== undefined && value !== null) {
  process.stdout.write(String(value));
}
"
}

require_file "$CONFIG_FILE"
require_executable "./start.sh"

if ! command -v node >/dev/null 2>&1; then
    fail "Node.js non trovato: serve per leggere $CONFIG_FILE"
fi

AWS_REGION="$(CONFIG_FILE="$CONFIG_FILE" read_config_value "config.aws && config.aws.region")"
AWS_PROFILE="$(CONFIG_FILE="$CONFIG_FILE" read_config_value "config.aws && config.aws.profile")"

[ -n "$AWS_REGION" ] || fail "campo aws.region mancante in $CONFIG_FILE"

if [ -z "$AWS_PROFILE" ]; then
    log "AWS profile non configurato: uso credential chain standard AWS (IRSA/env/metadata)."
    exit 0
fi

if ! command -v aws >/dev/null 2>&1; then
    fail "AWS CLI v2 non trovata: necessaria per creare/rinnovare il token SSO del profilo $AWS_PROFILE"
fi

AWS_VERSION_MAJOR="$(aws --version 2>&1 | sed -n 's#aws-cli/\([0-9][0-9]*\).*#\1#p')"
[ "${AWS_VERSION_MAJOR:-0}" -ge 2 ] || fail "AWS CLI v2 richiesta per SSO"

log "Verifico AWS SSO per profilo $AWS_PROFILE..."

if node scripts/check-sso-expiry.js "$AWS_PROFILE" >/dev/null 2>&1 \
    && aws sts get-caller-identity --profile "$AWS_PROFILE" >/dev/null 2>&1; then
    log "Token SSO valido."
    exit 0
fi

if [ "$SSO_LOGIN_MODE" = "never" ]; then
    fail "token SSO assente o scaduto per $AWS_PROFILE e AWS_SSO_LOGIN_MODE=never"
fi

LOGIN_ARGS=(sso login --profile "$AWS_PROFILE")
if [ "${AWS_SSO_NO_BROWSER:-0}" = "1" ] || [ -z "${DISPLAY:-}" ]; then
    LOGIN_ARGS+=(--no-browser)
fi

log "Token SSO assente/scaduto: avvio bootstrap SSO."
aws "${LOGIN_ARGS[@]}"

aws sts get-caller-identity --profile "$AWS_PROFILE" >/dev/null \
    || fail "login SSO completato ma identita AWS non verificabile per $AWS_PROFILE"

log "SSO pronto."
