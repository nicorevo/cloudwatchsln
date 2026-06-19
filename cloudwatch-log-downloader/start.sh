#!/bin/bash

echo "🚀 Avvio CloudWatch Log Downloader..."

# Verifica Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js non trovato. Installare Node.js prima di continuare."
    exit 1
fi

# Verifica npm
if ! command -v npm &> /dev/null; then
    echo "❌ npm non trovato."
    exit 1
fi

# Installa dipendenze se necessario
if [ ! -d "node_modules" ]; then
    echo "📦 Installazione dipendenze..."
    npm install
fi

# Verifica config
CONFIG_ENV="${CONFIG_ENV:-uat}"
CONFIG_FILE="config.${CONFIG_ENV}.json"

if [ ! -f "$CONFIG_FILE" ]; then
    echo "❌ $CONFIG_FILE non trovato."
    echo "   Copia config.sample.json in $CONFIG_FILE e personalizza i valori."
    exit 1
fi

# Verifica AWS CLI
if ! command -v aws &> /dev/null; then
    echo "⚠️  AWS CLI non trovato. Potrebbe essere necessario per SSO."
    echo "   Su Endeavour OS: yay -S aws-cli-v2"
    echo "   Continuare comunque? (y/n)"
    read -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

echo "✅ Avvio del servizio..."

AWS_PROFILE=$(node -pe "require('./${CONFIG_FILE}').aws.profile")

if [ -n "$AWS_PROFILE" ]; then
    echo "Profilo AWS: $AWS_PROFILE"
    aws sso login --profile "$AWS_PROFILE"
    aws sts get-caller-identity --profile "$AWS_PROFILE"
fi

npm run "check-sso-expiry:${CONFIG_ENV}" 2>/dev/null || npm run check-sso-expiry:prod
npm run "start:${CONFIG_ENV}"
