# Phase 2 Findings: OAuth Refresh Blocker

## 🚫 Critical Discovery

**OpenCode OAuth refresh is INTERNAL ONLY** - no public API endpoint available for external token refresh.

## Research Summary

### What We Found

**GitHub Issue #9121** mentioned `POST /v1/oauth/token` but this is for:
- **Anthropic OAuth** (Claude provider)
- **NOT OpenCode's own OAuth**

**OpenCode API Docs** show OAuth config schema but:
- No `/oauth/token` refresh endpoint documented
- No public refresh API
- Tokens managed internally by OpenCode

### Test Results

```bash
POST https://opencode.ai/console/v1/oauth/token
Body: { grant_type: "refresh_token", refresh_token: "rt_..." }
Result: 405 Method Not Allowed
```

**Conclusion:** OpenCode does NOT expose OAuth refresh to external clients.

## Why This Matters

**Original Plan (BLOCKED):**
```
External Rotator → Refresh tokens independently → Pool accounts
```

**Reality:**
```
OpenCode CLI → Manages OAuth internally → Tokens in SQLite
                     ↓
            We can only READ tokens,
            not refresh them externally
```

## 🔄 Revised Architecture Options

### Option A: Multi-Instance Proxy (Recommended)

Run multiple OpenCode instances, each with one free account:

```
┌─────────────────────────────────────────┐
│  Rotator Gateway (Our Code)             │
│  - Route requests to instances          │
│  - Track quota (200 req/day)            │
│  - Read tokens from each SQLite         │
└──────────────┬──────────────────────────┘
               │ Forward to instance
         ┌─────┴─────┬─────────────┐
         ▼           ▼             ▼
    ┌────────┐  ┌────────┐   ┌────────┐
    │OpenCode│  │OpenCode│   │OpenCode│
    │Instance│  │Instance│   │Instance│
    │   #1   │  │   #2   │   │   #3   │
    │150/200 │  │  5/200 │   │195/200 │
    │SQLite 1│  │SQLite 2│   │SQLite 3│
    └────────┘  └────────┘   └────────┘
```

**Pros:**
- ✅ Each instance handles its own refresh
- ✅ No need to reverse-engineer OAuth
- ✅ Isolated quota per account

**Cons:**
- ❌ Multiple OpenCode processes
- ❌ Resource intensive (N instances)
- ❌ Complex setup (N SQLite databases)

### Option B: Read-Only Token Extraction

Just read tokens from SQLite, let single OpenCode instance refresh:

```
┌─────────────────────────────────────────┐
│  Rotator Gateway                        │
│  - Read access tokens from SQLite       │
│  - Forward with tokens to OpenCode API  │
│  - Track quota per account              │
└──────────────┬──────────────────────────┘
               │ Use tokens directly
               ▼
    ┌──────────────────────┐
    │ OpenCode API         │
    │ (api.opencode.ai)    │
    └──────────────────────┘

Token refresh handled by:
    OpenCode CLI (background process)
```

**Pros:**
- ✅ Simple - just read SQLite
- ✅ Single OpenCode process
- ✅ OpenCode handles refresh

**Cons:**
- ❌ Limited to ONE account (OpenCode CLI limitation?)
- ❌ Unclear if OpenCode supports multiple accounts
- ❌ Token may expire between reads

### Option C: Abandon OAuth, Use OpenCode Go API Keys

OpenCode Go (paid, but has free tier) might use simple API keys:

**Research needed:**
- Does OpenCode Go use API keys instead of OAuth?
- Can we pool multiple Go free accounts?
- What's the authentication model?

## 🎯 Recommended Path Forward

**Phase 2.1: Research OpenCode Multi-Account Support**

Before building complex multi-instance proxy, answer:

1. **Can OpenCode CLI manage multiple accounts natively?**
   - Check `/connect` for account switching
   - Test adding 2+ OpenCode accounts
   - See if SQLite supports multiple credentials

2. **What's OpenCode Go's authentication model?**
   - Is it API key-based or OAuth?
   - Can we extract/pool Go keys?
   - Free tier limits?

3. **Is there an unofficial OAuth refresh endpoint?**
   - Check OpenCode source code on GitHub
   - Look for internal refresh implementation
   - Maybe can call same internal endpoint

## Next Action

**Before continuing implementation:**
1. Research OpenCode multi-account support
2. Test adding 2+ accounts in one OpenCode instance
3. Examine OpenCode source code for refresh logic
4. Decide between Option A, B, or C

**If multi-account is NOT supported:**
- Fall back to Option A (multi-instance)
- Or abandon OpenCode pooling entirely
- Or wait for OpenCode to add multi-account support

---

**Status:** ⚠️ Phase 2 BLOCKED - OAuth refresh not externally accessible  
**Blocker:** Need to research OpenCode multi-account capabilities  
**Decision:** Hold implementation until multi-account feasibility confirmed
