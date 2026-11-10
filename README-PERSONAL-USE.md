# OpenCode Account Rotator - Personal Use

⚡ **Simple solution for personal OpenCode free tier quota management**

**Problem:** OpenCode free tier = 200 requests/day  
**Solution:** Rotate between multiple accounts manually or with simple script

---

## 🎯 For Personal Use (Recommended)

### Option 1: Manual Switching (Simplest)

**Setup once:**
```bash
# Create 3 accounts with separate databases
# Account 1: default database
# Account 2: db2.db
# Account 3: db3.db
```

**Daily usage:**
```bash
# Use account 1
opencode

# When quota runs out, use account 2
OPENCODE_DB=~/.local/share/opencode/db2.db opencode

# When quota runs out, use account 3
OPENCODE_DB=~/.local/share/opencode/db3.db opencode
```

**Result:** 200 × 3 = 600 requests/day

---

### Option 2: Alias (Better)

Add to `~/.bashrc` or `~/.zshrc`:

```bash
alias oc1='opencode'
alias oc2='OPENCODE_DB=~/.local/share/opencode/db2.db opencode'
alias oc3='OPENCODE_DB=~/.local/share/opencode/db3.db opencode'
```

**Usage:**
```bash
oc1  # Use account 1
oc2  # Use account 2
oc3  # Use account 3
```

---

### Option 3: Auto-Rotate Script (Advanced)

**Linux/Mac:**
```bash
chmod +x opencode-rotate.sh
./opencode-rotate.sh
```

**Windows:**
```cmd
opencode-rotate.bat
```

**How it works:**
- Tracks current account in `~/.opencode-current-account`
- Automatically rotates on failure (assumes quota exceeded)
- Simple round-robin: 1 → 2 → 3 → 1

---

## 📝 Setup Guide

### Step 1: Create Multiple Accounts

You need 3+ separate email accounts (Gmail, Outlook, etc.)

### Step 2: Authenticate Each Account

**Account 1 (default):**
```bash
opencode
/connect
# Sign in with account1@example.com
```

**Account 2:**
```bash
OPENCODE_DB=~/.local/share/opencode/db2.db opencode
/connect
# Sign in with account2@example.com
```

**Account 3:**
```bash
OPENCODE_DB=~/.local/share/opencode/db3.db opencode
/connect
# Sign in with account3@example.com
```

### Step 3: Verify

Check credentials exist:
```bash
ls ~/.local/share/opencode/*.db
# Should see: opencode.db, db2.db, db3.db
```

---

## 🎨 Why This Works

**Simple facts:**
- Each `OPENCODE_DB` = separate account
- Each account = 200 req/day
- 3 accounts = 600 req/day
- No complex gateway needed for personal use!

**vs Original Project:**
- ✅ Solves same problem (more requests)
- ✅ 5 minutes setup vs 8 hours
- ✅ No server management
- ✅ Works on personal machine
- ❌ Not a production API service
- ❌ Not automatic (manual switching)

---

## 🚀 Quick Start (5 Minutes)

```bash
# 1. Add aliases
echo 'alias oc1="opencode"' >> ~/.bashrc
echo 'alias oc2="OPENCODE_DB=~/.local/share/opencode/db2.db opencode"' >> ~/.bashrc
echo 'alias oc3="OPENCODE_DB=~/.local/share/opencode/db3.db opencode"' >> ~/.bashrc
source ~/.bashrc

# 2. Authenticate accounts
oc1
/connect  # account1@example.com

oc2
/connect  # account2@example.com

oc3
/connect  # account3@example.com

# 3. Use it!
oc1  # Start with account 1
# When quota runs out:
oc2  # Switch to account 2
```

**Done! 600 req/day with 3 accounts** 🎉

---

## 📊 Comparison

| Solution | Setup Time | Daily Quota | Complexity | Use Case |
|----------|------------|-------------|------------|----------|
| **Manual switching** | 5 min | 600+ | ⭐ Simple | Personal use |
| **Alias** | 10 min | 600+ | ⭐ Simple | Personal use |
| **Auto-rotate script** | 15 min | 600+ | ⭐⭐ Medium | Personal use |
| **Gateway (original)** | 8-16 hours | 600+ | ⭐⭐⭐⭐⭐ Complex | Production API service |

---

## 🎓 When to Use What

### Use Manual/Alias If:
- ✅ Personal machine
- ✅ You control when to switch
- ✅ Want simple solution
- ✅ Don't need automation

### Use Gateway (Original Project) If:
- ❌ Need automatic quota management
- ❌ Multiple users/clients
- ❌ Production API service
- ❌ Don't want manual switching
- ✅ Have 8-16 hours to implement translation layer

**For personal use: Manual/Alias is enough!**

---

## 💡 Pro Tips

**Track usage manually:**
```bash
# Keep a simple log
echo "$(date): Used account 1" >> ~/opencode-usage.log
```

**Check remaining quota:**
- OpenCode UI shows usage
- Or estimate: 200 req/day ÷ 24 hours ≈ 8 req/hour

**Reset time:**
- Free tier resets at midnight (provider's timezone)
- Track manually or wait for 429 errors

---

## 🏆 Conclusion

**For personal use on your own machine:**
- ✅ Don't need complex gateway
- ✅ Simple alias/script is enough
- ✅ 5 minutes setup vs 8 hours
- ✅ Same result: 600+ req/day

**The original gateway project was valuable for:**
- 🎓 Learning OpenCode architecture
- 🔬 Research findings documented
- 💡 Understanding API limitations
- ⚠️ Realizing simpler solutions exist

**Lesson:**
> "Sometimes the best solution is the simplest one." 

---

**Status:** ✅ Simple personal solution ready  
**Setup time:** 5-15 minutes  
**Daily quota:** 200 × N accounts  
**Complexity:** ⭐ Simple
