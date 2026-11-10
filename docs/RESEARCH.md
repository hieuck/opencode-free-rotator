# OpenCode Free Tier Research - Phase 1 Complete

## 🎯 Critical Findings

### Authentication Model: OAuth (Not API Keys!)

OpenCode free tier uses **OAuth 2.0 device flow**, not simple API keys. This is fundamentally different from Kiro pooling.

### Credential Storage

**Location:** `~/.local/share/opencode/opencode.db` (SQLite)

**Table:** `credential`
```sql
CREATE TABLE credential (
  id TEXT,
  integration_id TEXT,     -- 'opencode', '9router', etc.
  label TEXT,              -- Email or custom label
  value TEXT,              -- JSON string with OAuth tokens
  connector_id TEXT,
  method_id TEXT,
  active INTEGER,
  time_created INTEGER,
  time_updated INTEGER
);
```

**Credential Value Structure:**
```json
{
  "type": "oauth",
  "methodID": "device",
  "refresh": "rt_439e74e7a...",     // Refresh token
  "access": "st_3dc589c6...",       // Access token  
  "expires": 1796398028784,         // Unix timestamp (ms)
  "metadata": {
    "server": "https://api.opencode.ai",
    "accountID": "acc_...",
    "email": "user@example.com",
    "orgID": "org_...",
    "orgName": "Personal"
  }
}
```

### Token Lifecycle

**Current token expiry:** Dec 4, 2026 (~24 days from now)

**OAuth Flow:**
1. Device code flow (`/connect` in TUI)
2. Access token expires after ~30 days
3. Use refresh token to get new access token
4. Refresh token may also expire (need to test)

## ❌ Why Simple Pooling Won't Work

**Original assumption:** Multiple API keys → round-robin rotation

**Reality:**
- ✅ Kiro: Session-based with encrypted credentials
- ✅ Codex: API tokens in JSON files  
- ✅ Cursor: Token + machine ID pairs
- ❌ OpenCode: OAuth refresh token flow

**Complexity increase:**
- Need OAuth client implementation
- Handle token refresh before expiry
- Track refresh failures (account suspended?)
- Store refresh + access tokens securely

## 🔄 New Approach: OAuth Token Pool

### Architecture v2

```
┌─────────────────────────────────────────┐
│  Rotator Service                        │
│  ┌────────────────────────────────────┐ │
│  │  Account Pool Manager              │ │
│  │  - Load OAuth credentials          │ │
│  │  - Check token expiry              │ │
│  │  - Auto-refresh if needed          │ │
│  │  - Track daily quota (200 req)     │ │
│  └────────────────────────────────────┘ │
│  ┌────────────────────────────────────┐ │
│  │  OAuth Refresh Handler             │ │
│  │  - POST /auth/token/refresh        │ │
│  │  - Update access token in pool     │ │
│  │  - Persist to storage              │ │
│  └────────────────────────────────────┘ │
└──────────────┬──────────────────────────┘
               │ Forward with fresh token
         ┌─────┴─────┬─────────────┐
         ▼           ▼             ▼
    ┌────────┐  ┌────────┐   ┌────────┐
    │OpenCode│  │OpenCode│   │OpenCode│
    │ Free 1 │  │ Free 2 │   │ Free N │
    │150/200 │  │  5/200 │   │195/200 │
    │ Token  │  │ Token  │   │ Token  │
    │ Valid  │  │ Valid  │   │Expires │
    │        │  │        │   │in 2h   │
    └────────┘  └────────┘   └────────┘
                              ↓ refresh
```

## 📋 Updated Implementation Plan

### Phase 1: ✅ Complete
- [x] Locate SQLite database
- [x] Understand credential structure
- [x] Identify OAuth token format
- [x] Document token expiry

### Phase 2: OAuth Client (NEW)
- [ ] Research OpenCode OAuth refresh endpoint
- [ ] Implement token refresh function
- [ ] Test refresh with current credential
- [ ] Handle refresh failures gracefully

### Phase 3: Multi-Account Storage
- [ ] Design external credential storage (not SQLite)
- [ ] Secure storage for refresh + access tokens
- [ ] CLI: Add account (extract from OpenCode DB)
- [ ] CLI: List accounts with status
- [ ] CLI: Remove account

### Phase 4: Rotation Logic
- [ ] Load accounts on startup
- [ ] Pre-flight token check (expiry < 1h → refresh)
- [ ] Round-robin with quota awareness
- [ ] Daily quota tracking (200 req/day)
- [ ] Quota reset detection

### Phase 5: Integration
- [ ] OpenAI-compatible proxy
- [ ] Forward requests with fresh tokens
- [ ] Error handling (429, 401)
- [ ] Automatic retry with next account

## 🔬 Next Research Questions

### OAuth Endpoint Discovery
1. **Refresh endpoint:** `POST https://api.opencode.ai/auth/token/refresh`?
2. **Request body:** `{ "refresh_token": "rt_..." }`?
3. **Response format:** New `access_token` + `expires_in`?
4. **Refresh token rotation:** Does refresh token change?

### Quota Tracking
1. **Response headers:** `X-RateLimit-Limit`, `X-RateLimit-Remaining`?
2. **429 response body:** Quota info? Reset time?
3. **Reset timing:** Midnight UTC? Local timezone? Account creation time?

### Security
1. **Token encryption:** Store tokens encrypted like Kiro?
2. **Refresh token lifetime:** Days? Weeks? Months?
3. **Account bans:** How to detect suspended accounts?

## ⚠️ Risks & Challenges

**Technical:**
- OAuth refresh implementation complexity
- Token synchronization across instances
- Race conditions on concurrent refresh

**Operational:**
- Need multiple OpenCode free accounts
- Each account requires separate email + OAuth flow
- Refresh token may expire → manual re-auth

**Security:**
- Storing refresh tokens is sensitive
- Compromise = full account access
- Need encryption at rest

## 💡 Alternative Approaches

### Option A: OAuth Pool (Current Plan)
✅ Full control over rotation  
✅ Can optimize quota usage  
❌ Complex OAuth implementation  
❌ Need secure token storage  

### Option B: OpenCode Native Multi-Account
✅ Use OpenCode's built-in account switching  
✅ No OAuth implementation needed  
❌ Still need quota tracking  
❌ May not support automation  

### Option C: Proxy with Account Metadata
✅ Simple API key forwarding  
✅ Let OpenCode handle refresh  
❌ Limited control over rotation  
❌ Can't prevent quota exhaustion  

**Recommendation:** Continue with Option A (OAuth Pool) but validate refresh endpoint first.

## 📚 References

- [OpenCode V2 Providers Docs](https://opencode.ai/v2/docs/cli/providers)
- [OAuth 2.0 Device Flow](https://oauth.net/2/device-flow/)
- SQLite database: `C:\Users\hieut\.local\share\opencode\opencode.db`

---

**Status:** Phase 1 ✅ Complete  
**Next:** Research OpenCode OAuth refresh endpoint  
**Blocker:** Need to understand refresh API before multi-account implementation
