#!/bin/bash

echo "🚀 Installing AWS CLI v2 on Endeavour OS"
echo "==========================================="

# Check system
if ! grep -q "EndeavourOS\|Arch Linux" /etc/os-release 2>/dev/null; then
    echo "⚠️  This script is optimized for Endeavour OS / Arch Linux"
    echo "   Continue anyway? (y/n)"
    read -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

echo "📋 AWS CLI v2 installation options:"
echo "1. AUR (yay/paru) - Recommended for Arch/Endeavour OS"
echo "2. Direct AWS download - Universal"
echo "3. Snap - Alternative"
echo ""

read -p "Choose method (1/2/3): " -n 1 -r
echo

case $REPLY in
    1)
        echo "🔧 Installing via AUR..."

        if command -v yay &> /dev/null; then
            echo "✅ yay found"
            yay -S aws-cli-v2
        elif command -v paru &> /dev/null; then
            echo "✅ paru found"
            paru -S aws-cli-v2
        else
            echo "❌ yay or paru not found. Installing yay..."

            sudo pacman -S --needed git base-devel
            cd /tmp
            git clone https://aur.archlinux.org/yay.git
            cd yay
            makepkg -si --noconfirm
            cd ~

            echo "✅ yay installed. Installing AWS CLI v2..."
            yay -S aws-cli-v2 --noconfirm
        fi
        ;;

    2)
        echo "📥 Direct download from AWS..."

        sudo pacman -S --needed curl unzip

        cd /tmp
        curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
        unzip -q awscliv2.zip

        sudo ./aws/install

        rm -rf aws awscliv2.zip
        cd ~

        echo "✅ AWS CLI v2 installed via direct download"
        ;;

    3)
        echo "📦 Installing via Snap..."

        if ! command -v snap &> /dev/null; then
            echo "📦 Installing snapd..."
            sudo pacman -S snapd
            sudo systemctl enable --now snapd.socket
            sudo ln -sf /var/lib/snapd/snap /snap

            echo "⚠️  Reboot the system and rerun this script to install AWS CLI via snap"
            exit 1
        fi

        sudo snap install aws-cli --classic
        ;;

    *)
        echo "❌ Invalid option"
        exit 1
        ;;
esac

echo ""
echo "🔍 Verifying installation..."
if command -v aws &> /dev/null; then
    aws --version

    VERSION=$(aws --version 2>&1 | grep -o "aws-cli/[0-9]" | cut -d/ -f2)
    if [ "$VERSION" = "2" ]; then
        echo "✅ AWS CLI v2 installed successfully!"
        echo ""
        echo "🎉 You can now configure AWS SSO:"
        echo "   ./setup-sso.sh"
    else
        echo "⚠️  AWS CLI v1 is installed. SSO requires v2."
        echo "   Try another installation method"
    fi
else
    echo "❌ aws command not found. Restart the terminal"
    echo "   or add to PATH: export PATH=$PATH:/usr/local/bin"
fi

echo ""
echo "📚 Next steps:"
echo "1. ./setup-sso.sh (configure SSO)"
echo "2. Copy config.sample.json to config.uat.json or config.prod.json and customize"
echo "3. npm install && npm start"
