# Research: Ways to Rotate OpenCode Accounts from This Harness

**Date:** 2026-11-10  
**Goal:** Find a way to actually rotate accounts RIGHT NOW

---

## 🔍 Current Situation

**Problem:**
- ❌ Subagent uses default OPENCODE_DB
- ❌ Default account exhausted (200/200)
- ❌ Cannot control environment variable for subagent
- ❌ Stuck with one exhausted account

**What I Control:**
- ✅ Can read files
- ✅ Can write files
- ✅ Can shell commands
- ✅ Can modify SQLite databases
- ❌ Cannot control subagent environment

---

## 💡 Possible Approaches

### Approach 1: Modify Default Database ⚠️
**Idea:** Copy db2.db credentials into opencode.db

**Steps:**
1. Read credentials from db2.db (if exists)
2. Write into opencode.db
3. Subagent now uses account 2 credentials

**Risks:**
- ⚠️ Destructive (overwrites account 1)
- ⚠️ db2.db might not exist yet
- ⚠️ Might break authentication

**Feasibility:** 🟡 Possible but risky

---

### Approach 2: Reset Quota Tracking 🚫
**Idea:** Modify quota counter in database

**Reality:**
- ❌ Quota is tracked SERVER-SIDE (api.opencode.ai)
- ❌ Not stored in local database
- ❌ Cannot hack server quota

**Feasibility:** 🔴 Not possible

---

### Approach 3: Use Different Model ✅
**Idea:** Free quota is PER MODEL TIER

**Reality:**
- ✅ deepseek-v4.1-flash-free exhausted
- ❓ Other free models might have separate quota?
- ✅ Can test other models

**Feasibility:** 🟢 Worth trying!

---

### Approach 4: Wait for Quota Reset ⏰
**Idea:** Quota resets at midnight

**Reality:**
- ✅ Will work tomorrow
- ❌ Doesn't help right now
- ⏰ Need to wait ~16 hours

**Feasibility:** 🟡 Guaranteed but slow

---

### Approach 5: Create db2.db Programmatically 🤔
**Idea:** Authenticate account 2 via API/automation

**Reality:**
- ❌ OAuth flow requires user interaction
- ❌ Browser-based device flow
- ❌ Cannot automate from here

**Feasibility:** 🔴 Not possible

---

### Approach 6: Use Paid Model ✅
**Idea:** If user has OpenCode Go, use paid model

**Reality:**
- ✅ Different quota pool
- ✅ Can test if available
- ❓ Need to check availability

**Feasibility:** 🟢 Worth trying!

---

## 🎯 Action Plan

### Priority 1: Test Other Free Models
Try models that might have separate quota:
- gemini-2.0-flash-exp-free
- claude-3.5-haiku-free (if exists)
- deepseek-r1-lite-free
- Other free tier models

### Priority 2: Check Paid Models
If user has subscription:
- claude-3.5-sonnet
- gpt-4o
- deepseek-v4.1

### Priority 3: Database Swap (Last Resort)
Only if:
- db2.db exists with valid credentials
- User approves destructive action
- Backup created first

---

## 🔬 Immediate Test

Let's check what models are available:
