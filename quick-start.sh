#!/bin/bash
# One-Command Setup - OpenCode Free Rotator
# Usage: ./quick-start.sh

set -e

echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║                                                            ║"
echo "║  🚀 OpenCode Free Rotator - Quick Start                   ║"
echo "║     End-to-End Setup in One Command                       ║"
echo "║                                                            ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if OpenCode is installed
echo "📋 Step 1/5: Checking OpenCode installation..."
if ! command -v opencode &> /dev/null; then
    echo -e "${RED}❌ OpenCode not found${NC}"
    echo ""
    echo "Please install OpenCode first:"
    echo "  npm install -g opencode"
    echo ""
    echo "Or visit: https://opencode.ai"
    exit 1
fi
echo -e "${GREEN}✅ OpenCode found: $(which opencode)${NC}"
echo ""

# Check Node.js
echo "📋 Step 2/5: Checking Node.js..."
if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js not found${NC}"
    echo "Please install Node.js v18+ first"
    exit 1
fi
echo -e "${GREEN}✅ Node.js found: $(node --version)${NC}"
echo ""

# Install dependencies
echo "📋 Step 3/5: Installing dependencies..."
if [ ! -d "node_modules" ]; then
    npm install
fi
echo -e "${GREEN}✅ Dependencies installed${NC}"
echo ""

# Check account authentication
echo "📋 Step 4/5: Checking account authentication..."
DATA_DIR="$HOME/.local/share/opencode"
mkdir -p "$DATA_DIR"

DB1="$DATA_DIR/opencode.db"
DB2="$DATA_DIR/db2.db"
DB3="$DATA_DIR/db3.db"

ACCOUNTS_READY=0

if [ -f "$DB1" ] && [ -s "$DB1" ]; then
    echo -e "${GREEN}✅ Account 1: Authenticated${NC}"
    ACCOUNTS_READY=$((ACCOUNTS_READY + 1))
else
    echo -e "${YELLOW}⚠️  Account 1: Not authenticated${NC}"
fi

if [ -f "$DB2" ] && [ -s "$DB2" ]; then
    echo -e "${GREEN}✅ Account 2: Authenticated${NC}"
    ACCOUNTS_READY=$((ACCOUNTS_READY + 1))
else
    echo -e "${YELLOW}⚠️  Account 2: Not authenticated${NC}"
fi

if [ -f "$DB3" ] && [ -s "$DB3" ]; then
    echo -e "${GREEN}✅ Account 3: Authenticated${NC}"
    ACCOUNTS_READY=$((ACCOUNTS_READY + 1))
else
    echo -e "${YELLOW}⚠️  Account 3: Not authenticated${NC}"
fi

echo ""
echo -e "${GREEN}📊 Accounts Ready: ${ACCOUNTS_READY}/3${NC}"
echo ""

if [ $ACCOUNTS_READY -eq 0 ]; then
    echo -e "${RED}❌ No accounts authenticated!${NC}"
    echo ""
    echo "Please authenticate at least one account:"
    echo ""
    echo "  # Account 1"
    echo "  opencode"
    echo "  > /connect"
    echo ""
    echo "  # Account 2"
    echo "  OPENCODE_DB=$DATA_DIR/db2.db opencode"
    echo "  > /connect"
    echo ""
    echo "  # Account 3"
    echo "  OPENCODE_DB=$DATA_DIR/db3.db opencode"
    echo "  > /connect"
    echo ""
    echo "Then run this script again!"
    exit 1
fi

if [ $ACCOUNTS_READY -lt 3 ]; then
    echo -e "${YELLOW}⚠️  Only ${ACCOUNTS_READY}/3 accounts authenticated${NC}"
    echo "Gateway will work with ${ACCOUNTS_READY} × 200 = $((ACCOUNTS_READY * 200)) req/day"
    echo ""
    echo "To add more accounts, authenticate them:"
    
    if [ ! -f "$DB2" ] || [ ! -s "$DB2" ]; then
        echo "  OPENCODE_DB=$DATA_DIR/db2.db opencode"
        echo "  > /connect"
    fi
    
    if [ ! -f "$DB3" ] || [ ! -s "$DB3" ]; then
        echo "  OPENCODE_DB=$DATA_DIR/db3.db opencode"
        echo "  > /connect"
    fi
    echo ""
    read -p "Continue with ${ACCOUNTS_READY} account(s)? [Y/n] " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]] && [[ ! -z $REPLY ]]; then
        exit 1
    fi
fi

# Start gateway
echo "📋 Step 5/5: Starting gateway..."
echo ""

node src/SimpleGateway.mjs
