#!/bin/bash

echo "🚀 Starting CloudWatch Log Downloader..."

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js not found. Install Node.js before continuing."
    exit 1
fi

# Check npm
if ! command -v npm &> /dev/null; then
    echo "❌ npm not found."
    exit 1
fi

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
fi

# Check config
CONFIG_ENV="${CONFIG_ENV:-uat}"
CONFIG_FILE="config.${CONFIG_ENV}.json"

if [ ! -f "$CONFIG_FILE" ]; then
    echo "❌ $CONFIG_FILE not found."
    echo "   Copy config.sample.json to $CONFIG_FILE and customize the values."
    exit 1
fi

# Check AWS CLI
if ! command -v aws &> /dev/null; then
    echo "⚠️  AWS CLI not found. It may be required for SSO."
    echo "   On Endeavour OS: yay -S aws-cli-v2"
    echo "   Continue anyway? (y/n)"
    read -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

echo "✅ Starting service..."

AWS_PROFILE=$(node -pe "require('./${CONFIG_FILE}').aws.profile")

if [ -n "$AWS_PROFILE" ]; then
    echo "AWS profile: $AWS_PROFILE"
    aws sso login --profile "$AWS_PROFILE"
    aws sts get-caller-identity --profile "$AWS_PROFILE"
fi

npm run "check-sso-expiry:${CONFIG_ENV}" 2>/dev/null || npm run check-sso-expiry:prod
npm run "start:${CONFIG_ENV}"
