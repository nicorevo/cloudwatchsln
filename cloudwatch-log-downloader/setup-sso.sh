#!/bin/bash

echo "🔐 AWS SSO setup for CloudWatch Log Downloader"
echo "================================================"

# Check AWS CLI
if ! command -v aws &> /dev/null; then
    echo "❌ AWS CLI not found. Install AWS CLI v2 before continuing."
    echo "   On Endeavour OS: yay -S aws-cli-v2"
    echo "   On other distributions: ./install-aws-cli-endeavour.sh"
    exit 1
fi

# Check AWS CLI version
AWS_VERSION=$(aws --version 2>&1 | cut -d/ -f2 | cut -d' ' -f1 | cut -d. -f1)
if [ "$AWS_VERSION" -lt 2 ]; then
    echo "❌ AWS CLI v1 found. Version 2 is required for SSO support."
    echo "   Upgrade to AWS CLI v2"
    exit 1
fi

echo "✅ AWS CLI v2 found"

# Configure SSO
echo ""
echo "📝 AWS SSO configuration"
echo "You will need the following information from your IT team:"
echo "  - SSO Start URL (e.g. https://your-company.awsapps.com/start)"
echo "  - SSO Region (e.g. eu-west-1)"
echo "  - AWS Account ID"
echo "  - Role name (e.g. PowerUserAccess)"
echo ""

read -p "Configure AWS SSO now? (y/n): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    aws configure sso --profile my-sso-profile

    if [ $? -eq 0 ]; then
        echo "✅ SSO configuration complete!"

        # Test login
        echo ""
        echo "🔐 Testing SSO login..."
        aws sso login --profile my-sso-profile

        if [ $? -eq 0 ]; then
            echo "✅ SSO login successful!"

            # Verify identity
            echo ""
            echo "🔍 AWS identity:"
            aws sts get-caller-identity --profile my-sso-profile

            echo ""
            echo "🎉 Setup complete! Next steps:"
            echo "  1. Copy config.sample.json to config.uat.json or config.prod.json"
            echo "  2. Customize AWS profile and logGroups"
            echo "  3. npm install"
            echo "  4. npm start"
            echo ""
            echo "💡 To renew the token: aws sso login --profile my-sso-profile"

        else
            echo "❌ SSO login failed. Check your configuration."
            exit 1
        fi
    else
        echo "❌ SSO configuration failed."
        exit 1
    fi
else
    echo ""
    echo "ℹ️ Configure manually with:"
    echo "   aws configure sso --profile my-sso-profile"
fi

echo ""
echo "📚 Documentation: https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sso.html"
