#!/bin/bash
# Genera un nuovo PRD da template
set -e

if [ -z "$1" ]; then
  echo "Usage: $0 <feature-name>"
  echo "Example: $0 user-authentication"
  exit 1
fi

FEATURE_NAME="$1"
DATE=$(date +%Y-%m-%d)
FILENAME="docs/PRD-${FEATURE_NAME}.md"

if [ -f "$FILENAME" ]; then
  echo "❌ File already exists: $FILENAME"
  exit 1
fi

cp docs/PRD-TEMPLATE.md "$FILENAME"
sed -i "s/\[FEATURE NAME\]/$FEATURE_NAME/g" "$FILENAME"
sed -i "s/YYYY-MM-DD/$DATE/g" "$FILENAME"

echo "✅ Created: $FILENAME"
echo "Next: Open $FILENAME and complete the PRD, then run /spec in Cursor"
