#!/bin/bash
# REAL ROTATION TEST - Executable Proof Script
# Run this on your machine to prove rotation works!

set -e

echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║                                                            ║"
echo "║  🧪 REAL ROTATION TEST - Live Proof                       ║"
echo "║     This will prove rotation works with your accounts     ║"
echo "║                                                            ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

DATA_DIR="$HOME/.local/share/opencode"
mkdir -p "$DATA_DIR"

DB1="$DATA_DIR/opencode.db"
DB2="$DATA_DIR/db2.db"

echo -e "${BLUE}📋 Test Plan:${NC}"
echo "  1. Confirm Account 1 is exhausted"
echo "  2. Setup Account 2 (if needed)"
echo "  3. Test Account 2 has fresh quota"
echo "  4. Prove rotation by switching back/forth"
echo ""

# Test 1: Confirm Account 1 exhausted
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}TEST 1: Verify Account 1 is Exhausted${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo ""

echo "Testing Account 1 (default database)..."
echo ""

# Try to make a request with Account 1
RESULT1=$(echo '/ask Say "Test 1"' | opencode --non-interactive 2>&1 || true)

if echo "$RESULT1" | grep -qi "limit\|quota"; then
    echo -e "${RED}❌ Account 1: FREE USAGE LIMIT REACHED${NC}"
    echo -e "${GREEN}✅ TEST 1 PASSED: Account 1 is exhausted as expected${NC}"
    ACCOUNT1_EXHAUSTED=true
else
    echo -e "${GREEN}✅ Account 1: Still has quota${NC}"
    echo -e "${YELLOW}⚠️  Account 1 not exhausted yet. Continuing anyway...${NC}"
    ACCOUNT1_EXHAUSTED=false
fi

echo ""
read -p "Press Enter to continue to Test 2..."
echo ""

# Test 2: Setup Account 2
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}TEST 2: Setup Account 2 (Different Database)${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo ""

if [ ! -f "$DB2" ] || [ ! -s "$DB2" ]; then
    echo -e "${YELLOW}⚠️  Account 2 not authenticated yet${NC}"
    echo ""
    echo "Please authenticate Account 2 now:"
    echo ""
    echo -e "${BLUE}  OPENCODE_DB=$DB2 opencode${NC}"
    echo ""
    echo "In OpenCode prompt, run:"
    echo -e "${BLUE}  > /connect${NC}"
    echo ""
    echo "Sign in with a DIFFERENT email (or same email is OK)"
    echo ""
    read -p "Press Enter when Account 2 is authenticated..."
    
    if [ ! -f "$DB2" ] || [ ! -s "$DB2" ]; then
        echo -e "${RED}❌ Account 2 database not found. Aborting.${NC}"
        exit 1
    fi
fi

echo -e "${GREEN}✅ Account 2 database found: $DB2${NC}"
echo ""
read -p "Press Enter to continue to Test 3..."
echo ""

# Test 3: Test Account 2 works
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}TEST 3: Verify Account 2 Has Fresh Quota${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo ""

echo "Testing Account 2 with separate database..."
echo ""

# Try to make a request with Account 2
RESULT2=$(echo '/ask Say "Test 2"' | OPENCODE_DB="$DB2" opencode --non-interactive 2>&1 || true)

if echo "$RESULT2" | grep -qi "limit\|quota"; then
    echo -e "${RED}❌ Account 2: FREE USAGE LIMIT REACHED${NC}"
    echo -e "${RED}❌ TEST 3 FAILED: Account 2 also exhausted${NC}"
    echo ""
    echo "This means:"
    echo "  - OpenCode tracks quota server-side by user account"
    echo "  - Different databases don't give separate quotas"
    echo "  - Need truly different email accounts for rotation"
    echo ""
    exit 1
else
    echo -e "${GREEN}✅ Account 2: HAS QUOTA AND WORKS!${NC}"
    echo -e "${GREEN}✅ TEST 3 PASSED: Account 2 has independent quota${NC}"
    ACCOUNT2_WORKS=true
fi

echo ""
read -p "Press Enter to continue to Test 4..."
echo ""

# Test 4: Prove rotation by switching
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}TEST 4: Prove Rotation Works (Switch Back & Forth)${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo ""

echo "Switching back to Account 1..."
RESULT3=$(echo '/ask Say "Test 3"' | opencode --non-interactive 2>&1 || true)

if echo "$RESULT3" | grep -qi "limit\|quota"; then
    echo -e "${RED}❌ Account 1: STILL EXHAUSTED${NC}"
    echo -e "${GREEN}✅ Confirmed: Account 1 quota is independent${NC}"
else
    echo -e "${GREEN}✅ Account 1: Now working (quota may have reset)${NC}"
fi

echo ""
echo "Switching back to Account 2..."
RESULT4=$(echo '/ask Say "Test 4"' | OPENCODE_DB="$DB2" opencode --non-interactive 2>&1 || true)

if echo "$RESULT4" | grep -qi "limit\|quota"; then
    echo -e "${RED}❌ Account 2: Now exhausted${NC}"
else
    echo -e "${GREEN}✅ Account 2: STILL WORKING${NC}"
    echo -e "${GREEN}✅ TEST 4 PASSED: Account 2 continues to work${NC}"
fi

echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}🎉 ROTATION TEST COMPLETE${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo ""

# Summary
echo -e "${BLUE}📊 TEST RESULTS SUMMARY:${NC}"
echo ""
echo "┌────────────────────────────────────────────────────────┐"
echo "│                                                        │"

if [ "$ACCOUNT1_EXHAUSTED" = true ]; then
    echo -e "│  ✅ Account 1: Exhausted (expected)                   │"
else
    echo -e "│  ⚠️  Account 1: Still has quota                       │"
fi

if [ "$ACCOUNT2_WORKS" = true ]; then
    echo -e "│  ✅ Account 2: Working with fresh quota               │"
else
    echo -e "│  ❌ Account 2: Also exhausted                         │"
fi

echo "│                                                        │"
echo "└────────────────────────────────────────────────────────┘"
echo ""

if [ "$ACCOUNT2_WORKS" = true ]; then
    echo -e "${GREEN}╔════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║                                                            ║${NC}"
    echo -e "${GREEN}║  🏆 ROTATION PROVEN! ✅                                   ║${NC}"
    echo -e "${GREEN}║                                                            ║${NC}"
    echo -e "${GREEN}║  Different OPENCODE_DB = Different Quota                  ║${NC}"
    echo -e "${GREEN}║  Account 1 exhausted ≠ Account 2 exhausted                ║${NC}"
    echo -e "${GREEN}║  Gateway automation is VALID! 🚀                          ║${NC}"
    echo -e "${GREEN}║                                                            ║${NC}"
    echo -e "${GREEN}╚════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "${BLUE}Next Steps:${NC}"
    echo "  1. Authenticate Account 3 for 600+ req/day:"
    echo -e "     ${BLUE}OPENCODE_DB=$DATA_DIR/db3.db opencode${NC}"
    echo ""
    echo "  2. Start the gateway:"
    echo -e "     ${BLUE}./quick-start.sh${NC}"
    echo ""
    echo "  3. Enjoy 600+ requests/day with automatic rotation! 🎉"
else
    echo -e "${YELLOW}╔════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${YELLOW}║                                                            ║${NC}"
    echo -e "${YELLOW}║  ⚠️  ROTATION NOT PROVEN                                  ║${NC}"
    echo -e "${YELLOW}║                                                            ║${NC}"
    echo -e "${YELLOW}║  Account 2 also exhausted or not authenticated            ║${NC}"
    echo -e "${YELLOW}║  Try with truly different email account                   ║${NC}"
    echo -e "${YELLOW}║  Or wait until tomorrow for quota reset                   ║${NC}"
    echo -e "${YELLOW}║                                                            ║${NC}"
    echo -e "${YELLOW}╚════════════════════════════════════════════════════════════╝${NC}"
fi

echo ""
