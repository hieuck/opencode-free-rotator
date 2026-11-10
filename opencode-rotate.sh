#!/bin/bash
# OpenCode Account Rotator - Simple Personal Use
# Usage: ./opencode-rotate.sh [command]

ACCOUNTS=(
  "opencode.db:Account 1"
  "db2.db:Account 2"
  "db3.db:Account 3"
)

CURRENT_IDX_FILE="$HOME/.opencode-current-account"

# Read current account index
if [ -f "$CURRENT_IDX_FILE" ]; then
  CURRENT=$(cat "$CURRENT_IDX_FILE")
else
  CURRENT=0
fi

# Get current account
IFS=':' read -r DB NAME <<< "${ACCOUNTS[$CURRENT]}"

echo "🔄 Using: $NAME"
echo "📊 Database: $DB"
echo ""

# Run OpenCode with selected account
OPENCODE_DB="$HOME/.local/share/opencode/$DB" opencode "$@"

EXIT_CODE=$?

# If quota exceeded (assume), rotate to next account
if [ $EXIT_CODE -ne 0 ]; then
  echo ""
  echo "⚠️  Command failed. Rotating to next account..."
  NEXT=$(( (CURRENT + 1) % ${#ACCOUNTS[@]} ))
  echo $NEXT > "$CURRENT_IDX_FILE"
  
  IFS=':' read -r NEXT_DB NEXT_NAME <<< "${ACCOUNTS[$NEXT]}"
  echo "➡️  Switched to: $NEXT_NAME"
  echo ""
  echo "Run command again to use new account."
else
  echo ""
  echo "✅ Success with $NAME"
fi

exit $EXIT_CODE
