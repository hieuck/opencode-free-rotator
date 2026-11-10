# How to Create Account 2 for DeepSeek Rotation

**Goal:** Continue using deepseek-v4.1-flash-free by rotating to Account 2

---

## 🎯 Step-by-Step Guide

### Step 1: Prepare Second Email
You need a DIFFERENT email from your current account:
- Current: hieuck.dev@gmail.com
- Needed: another.email@gmail.com (or any other email)

**Options:**
- Gmail: Create new account
- Outlook: Create new account
- Temp email: Use https://temp-mail.org

---

### Step 2: Authenticate Account 2

**Windows (PowerShell):**
```powershell
# Set environment to use db2.db
$env:OPENCODE_DB="$env:USERPROFILE\.local\share\opencode\db2.db"

# Start OpenCode with Account 2
opencode

# You'll see clean start (no history)
```

**Windows (CMD):**
```cmd
set OPENCODE_DB=%USERPROFILE%\.local\share\opencode\db2.db
opencode
```

---

### Step 3: Connect in OpenCode CLI

Inside OpenCode:
```
> /connect
```

This will:
1. Open browser for OAuth login
2. Ask you to login with email
3. **Use DIFFERENT email than Account 1!**
4. Complete authentication

---

### Step 4: Verify Account 2 Works

```
> /model opencode/deepseek-v4.1-flash-free
> /ask Write a haiku about rotation

# ✅ Should work! Fresh 200 quota!
```

---

### Step 5: Extract Token to Verify

From your machine:
```bash
cd opencode-free-rotator
node extract-tokens.mjs
```

Should show:
```
Account 1:
  ✅ Email: hieuck.dev@gmail.com
  ✅ Account ID: acc_01KREQ03BT3TJZBRGRWN1FQBN5
  ✅ Status: Exhausted (deepseek)

Account 2:
  ✅ Email: another.email@gmail.com
  ✅ Account ID: acc_DIFFERENT123
  ✅ Status: Fresh quota!
```

---

### Step 6: Use Gateway with Both Accounts

```bash
# Start gateway
node src/SimpleGateway.mjs

# Gateway will auto-rotate:
# Account 1 exhausted → switch to Account 2
# ✅ deepseek-v4.1-flash-free works again!
```

---

## 🚀 After Setup

**What you get:**
- Account 1: 200 req/day (currently exhausted)
- Account 2: 200 req/day (fresh!)
- Gateway: Auto-rotation between accounts

**Tomorrow:**
- Both accounts reset
- Total: 400 req/day for deepseek!

**With 3 accounts:**
- Account 1, 2, 3 = 600 req/day!

---

## ⚠️ Important Notes

**Same Email = Same Quota:**
- DO NOT use same email for Account 2
- Must be different email
- Otherwise quota is shared

**Database Files:**
- opencode.db = Account 1
- db2.db = Account 2
- db3.db = Account 3
- Each has separate credentials

**Gateway Behavior:**
- Tries Account 1 first
- If exhausted, tries Account 2
- If exhausted, tries Account 3
- Transparent to user

---

## 🎯 Expected Timeline

**Now:**
- Account 1: Exhausted
- Account 2: Not created yet

**After you create Account 2 (5 minutes):**
- Account 1: Still exhausted
- Account 2: Fresh 200 quota!
- Gateway: Can rotate!

**Tomorrow (after midnight UTC):**
- Account 1: Reset to 200
- Account 2: Reset to 200
- Total: 400 req/day!

---

## ✅ Success Criteria

You know it works when:
1. ✅ db2.db file exists
2. ✅ Account 2 shows different email in extract-tokens
3. ✅ Gateway successfully rotates to Account 2
4. ✅ deepseek-v4.1-flash-free works again!

---

**Current Status:** Waiting for you to create Account 2  
**Estimated Time:** 5 minutes  
**Result:** deepseek-v4.1-flash-free will work again! 🎉
