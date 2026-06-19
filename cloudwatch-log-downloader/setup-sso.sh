#!/bin/bash

echo "🔐 Setup AWS SSO per CloudWatch Log Downloader"
echo "================================================"

# Verifica se AWS CLI è installato
if ! command -v aws &> /dev/null; then
    echo "❌ AWS CLI non trovato. Installa AWS CLI v2 prima di continuare."
    echo "   Su Endeavour OS: yay -S aws-cli-v2"
    echo "   Su altre distribuzioni: ./install-aws-cli-endeavour.sh"
    exit 1
fi

# Verifica versione AWS CLI
AWS_VERSION=$(aws --version 2>&1 | cut -d/ -f2 | cut -d' ' -f1 | cut -d. -f1)
if [ "$AWS_VERSION" -lt 2 ]; then
    echo "❌ AWS CLI v1 trovato. È richiesta la versione 2 per il supporto SSO."
    echo "   Aggiorna a AWS CLI v2"
    exit 1
fi

echo "✅ AWS CLI v2 trovato"

# Configura SSO
echo ""
echo "📝 Configurazione AWS SSO"
echo "Hai bisogno delle seguenti informazioni dal tuo team IT:"
echo "  - SSO Start URL (es: https://your-company.awsapps.com/start)"
echo "  - SSO Region (es: eu-west-1)"
echo "  - Account ID AWS"
echo "  - Nome del ruolo (es: PowerUserAccess)"
echo ""

read -p "Vuoi configurare AWS SSO ora? (y/n): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    aws configure sso --profile my-sso-profile

    if [ $? -eq 0 ]; then
        echo "✅ Configurazione SSO completata!"

        # Test login
        echo ""
        echo "🔐 Test login SSO..."
        aws sso login --profile my-sso-profile

        if [ $? -eq 0 ]; then
            echo "✅ Login SSO riuscito!"

            # Verifica identità
            echo ""
            echo "🔍 Verifica identità AWS:"
            aws sts get-caller-identity --profile my-sso-profile

            echo ""
            echo "🎉 Setup completato! Ora:"
            echo "  1. Copia config.sample.json in config.uat.json o config.prod.json"
            echo "  2. Personalizza profile AWS e logGroups"
            echo "  2. npm install"
            echo "  3. npm start"
            echo ""
            echo "💡 Per rinnovare il token: aws sso login --profile my-sso-profile"

        else
            echo "❌ Login SSO fallito. Verifica la configurazione."
            exit 1
        fi
    else
        echo "❌ Configurazione SSO fallita."
        exit 1
    fi
else
    echo ""
    echo "ℹ️ Configura manualmente con:"
    echo "   aws configure sso --profile my-sso-profile"
fi

echo ""
echo "📚 Documentazione: https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sso.html"
