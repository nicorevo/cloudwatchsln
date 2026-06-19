#!/bin/bash

echo "🚀 Installazione AWS CLI v2 su Endeavour OS"
echo "==========================================="

# Verifica sistema
if ! grep -q "EndeavourOS\|Arch Linux" /etc/os-release 2>/dev/null; then
    echo "⚠️  Questo script è ottimizzato per Endeavour OS / Arch Linux"
    echo "   Continua comunque? (y/n)"
    read -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

echo "📋 Opzioni di installazione AWS CLI v2:"
echo "1. AUR (yay/paru) - Raccomandato per Arch/Endeavour OS"
echo "2. Download diretto AWS - Universale"
echo "3. Snap - Alternativo"
echo ""

read -p "Scegli metodo (1/2/3): " -n 1 -r
echo

case $REPLY in
    1)
        echo "🔧 Installazione tramite AUR..."

        # Verifica se yay è installato
        if command -v yay &> /dev/null; then
            echo "✅ yay trovato"
            yay -S aws-cli-v2
        elif command -v paru &> /dev/null; then
            echo "✅ paru trovato"  
            paru -S aws-cli-v2
        else
            echo "❌ yay o paru non trovati. Installiamo yay..."

            # Installa yay
            sudo pacman -S --needed git base-devel
            cd /tmp
            git clone https://aur.archlinux.org/yay.git
            cd yay
            makepkg -si --noconfirm
            cd ~

            echo "✅ yay installato. Ora installiamo AWS CLI v2..."
            yay -S aws-cli-v2 --noconfirm
        fi
        ;;

    2)
        echo "📥 Download diretto da AWS..."

        # Verifica dipendenze
        sudo pacman -S --needed curl unzip

        # Download AWS CLI v2
        cd /tmp
        curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
        unzip -q awscliv2.zip

        # Installa
        sudo ./aws/install

        # Cleanup
        rm -rf aws awscliv2.zip
        cd ~

        echo "✅ AWS CLI v2 installato tramite download diretto"
        ;;

    3)
        echo "📦 Installazione tramite Snap..."

        # Installa snapd se non presente
        if ! command -v snap &> /dev/null; then
            echo "📦 Installazione snapd..."
            sudo pacman -S snapd
            sudo systemctl enable --now snapd.socket
            sudo ln -sf /var/lib/snapd/snap /snap

            echo "⚠️  Riavvia il sistema e riesegui lo script per installare AWS CLI via snap"
            exit 1
        fi

        # Installa AWS CLI v2
        sudo snap install aws-cli --classic
        ;;

    *)
        echo "❌ Opzione non valida"
        exit 1
        ;;
esac

echo ""
echo "🔍 Verifica installazione..."
if command -v aws &> /dev/null; then
    aws --version

    # Verifica che sia v2
    VERSION=$(aws --version 2>&1 | grep -o "aws-cli/[0-9]" | cut -d/ -f2)
    if [ "$VERSION" = "2" ]; then
        echo "✅ AWS CLI v2 installato correttamente!"
        echo ""
        echo "🎉 Ora puoi configurare AWS SSO:"
        echo "   ./setup-sso.sh"
    else
        echo "⚠️  È installato AWS CLI v1. Per SSO serve la v2."
        echo "   Prova un altro metodo di installazione"
    fi
else
    echo "❌ aws comando non trovato. Riavvia il terminale"
    echo "   oppure aggiungi al PATH: export PATH=$PATH:/usr/local/bin"
fi

echo ""
echo "📚 Prossimi passi:"
echo "1. ./setup-sso.sh (configura SSO)"
echo "2. Copia config.sample.json in config.uat.json o config.prod.json e personalizza"
echo "3. npm install && npm start"
