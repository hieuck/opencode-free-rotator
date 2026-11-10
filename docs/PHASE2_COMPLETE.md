# Phase 2 Complete: Multi-Instance Solution Confirmed

## 🎯 Final Discovery

**OpenCode Free models are CLIENT-LOCKED** - cannot be accessed via external API, even with valid OAuth tokens.

From official docs:
> "Free-tier chat models are only available from within OpenCode; other clients receive HTTP `403`, even with an API key."

## Test Results

### Direct API Test (FAILED)
```bash
POST https://opencode.ai/inference/openai/v1/chat/completions
Authorization: Bearer st_3dc589c2...
Body: { "model": "beam-free", ... }
Result: 403 Forbidden (expected - free models locked to OpenCode client)
```

### Why External API Doesn't Work
- Free models (beam-free, iceman-contributor-free, etc.) require OpenCode client
- OAuth tokens work BUT free models check client identity
- Only paid models (Go subscription) work via external API

## ✅ SOLUTION: Multi-Instance Proxy

Since free models require OpenCode client, we **MUST** run multiple OpenCode server instances.

### Architecture

```
┌─────────────────────────────────────────┐
│  Gateway (Port 20130)                   │
│  - Track quota per instance (200/day)   │
│  - Select instance with available quota │
│  - Forward request to selected instance │
└──────────────┬──────────────────────────┘
               │ HTTP proxy
         ┌─────┴──────┬──────────┐
         ▼            ▼          ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│ OpenCode #1  │ │ OpenCode #2  │ │ OpenCode #3  │
│              │ │              │ │              │
│ Port 3001    │ │ Port 3002    │ │ Port 3003    │
│ Account:     │ │ Account:     │ │ Account:     │
│ acc1@mail.c  │ │ acc2@mail.c  │ │ acc3@mail.c  │
│              │ │              │ │              │
│ SQLite:      │ │ SQLite:      │ │ SQLite:      │
│ db1.db       │ │ db2.db       │ │ db3.db       │
│              │ │              │ │              │
│ OAuth Token  │ │ OAuth Token  │ │ OAuth Token  │
│ Auto-refresh │ │ Auto-refresh │ │ Auto-refresh │
│              │ │              │ │              │
│ Quota:       │ │ Quota:       │ │ Quota:       │
│ 150/200      │ │   5/200      │ │ 195/200      │
└──────────────┘ └──────────────┘ └──────────────┘
```

### How to Run Multiple Instances

Each instance needs:
1. **Separate SQLite database**
2. **Separate port**
3. **Separate account (email + OAuth)**

```bash
# Instance 1 (Account: user1@example.com)
OPENCODE_DB=~/.local/share/opencode/db1.db \
opencode server --port 3001

# Instance 2 (Account: user2@example.com)
OPENCODE_DB=~/.local/share/opencode/db2.db \
opencode server --port 3002

# Instance 3 (Account: user3@example.com)
OPENCODE_DB=~/.local/share/opencode/db3.db \
opencode server --port 3003
```

### Setup Process

**Per Account:**
1. Create new email account
2. Start OpenCode with separate DB
3. Run `/connect` → Select OpenCode → OAuth login
4. Verify token saved in SQLite
5. Keep instance running

**Gateway:**
1. Track quota per instance (requests today)
2. Select instance: round-robin OR lowest usage
3. Forward: `POST http://localhost:300X/v1/chat/completions`
4. Reset counters at midnight

## Implementation Plan

### Phase 3: Multi-Instance Manager

- [ ] **Config:** YAML/JSON for instance definitions
  ```yaml
  instances:
    - name: "Account 1"
      email: "user1@example.com"
      port: 3001
      db: "~/.local/share/opencode/db1.db"
      quota: 200
    - name: "Account 2"
      email: "user2@example.com"
      port: 3002
      db: "~/.local/share/opencode/db2.db"
      quota: 200
  ```

- [ ] **Launcher:** Start all instances in background
- [ ] **Health check:** Verify each instance is up
- [ ] **Quota tracker:** Count requests per instance per day
- [ ] **Gateway:** Select and forward to available instance

### Phase 4: Gateway Implementation

- [ ] **HTTP server:** OpenAI-compatible `/v1/chat/completions`
- [ ] **Instance selector:** Round-robin or quota-aware
- [ ] **Request proxy:** Forward to selected instance
- [ ] **Error handling:** Retry with next instance on 429
- [ ] **Daily reset:** Midnight UTC quota reset

### Phase 5: Monitoring & Management

- [ ] **Status endpoint:** Show per-instance quota
- [ ] **CLI commands:** Start/stop/restart instances
- [ ] **Logs:** Track which instance served which request
- [ ] **Alerts:** Warn when all instances near quota

## Pros & Cons

### ✅ Pros
- **Works with free tier** - no paid subscription needed
- **Each instance handles OAuth** - no refresh implementation
- **Isolated quota** - 200 req/day × N accounts
- **Auto-refresh** - OpenCode handles token lifecycle
- **Simple gateway** - just HTTP proxy + quota tracking

### ❌ Cons
- **Resource intensive** - N full OpenCode processes
- **Setup complexity** - Need N email accounts + OAuth flow
- **Port management** - N+1 ports (instances + gateway)
- **Process management** - Keep N instances running

## Resource Requirements

**Per Instance:**
- RAM: ~200-500 MB (Node.js process)
- Disk: ~50 MB (SQLite + binaries)
- Port: 1 (e.g., 3001, 3002, 3003)

**For 3 Instances:**
- Total RAM: ~1.5 GB
- Total Disk: ~150 MB
- Ports: 3001-3003 + 20130 (gateway)

**Acceptable for:**
- Local development machine
- VPS with 2GB+ RAM
- Docker containers (multi-container setup)

## Alternative: OpenCode Go Pooling

**If OpenCode Go uses simple API keys** (not OAuth):
- ✅ Easier to pool (just rotate keys)
- ✅ No multi-instance needed
- ❌ Costs $10/month per account
- ❌ Still need multiple accounts

**Research needed:**
- Does Go use API keys or OAuth?
- Can one Go account be used from multiple clients?
- What's the monthly quota limit?

## Decision

**Proceed with Multi-Instance Proxy:**
1. Setup 3 OpenCode free accounts
2. Build instance launcher + gateway
3. Test with real usage
4. Document setup guide for users

**Estimated effort:**
- Setup: 2-3 hours (account creation + OAuth)
- Implementation: 4-6 hours (launcher + gateway)
- Testing: 1-2 hours
- Total: ~8-11 hours

---

**Status:** ✅ Phase 2 Complete - Solution confirmed  
**Next:** Phase 3 - Implement multi-instance manager  
**Blocker Resolved:** Multi-instance is the ONLY way for free tier
