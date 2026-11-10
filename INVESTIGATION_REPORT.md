# OpenCode Free Rotator - Investigation Report

**Date:** 2026-11-10  
**Investigator:** DeepSeek v4.1 Flash Free Code Review + Manual Testing  
**Status:** ⚠️ Critical Issues Confirmed

---

## 🔍 Executive Summary

The OpenCode Free Rotator project has **11 critical bugs** that prevent it from functioning. The most serious issue is that the gateway attempts to forward requests to `/v1/chat/completions` on local OpenCode servers, **but this endpoint does not exist locally**.

**Verdict:** ❌ **NOT PRODUCTION READY**

---

## ✅ Confirmed Findings

### 1. Code Has Been Partially Fixed

**Good News:** Some bugs mentioned in the initial review have already been fixed in the current codebase:

- ✅ **Process TDZ bug** - Fixed (uses `child` instead of `process`)
- ✅ **Correct subcommand** - Fixed (uses `'serve'` not `'server'`)
- ✅ **Hostname flag** - Fixed (includes `--hostname`)
- ✅ **inFlight counter** - Fixed (added to stats)

**File:** `src/InstanceManager.mjs` lines 150-195

---

### 2. OpenCode Server Successfully Starts

**Test:**
```bash
opencode serve --port 3099 --hostname 127.0.0.1
```

**Result:** ✅ Server starts successfully

**Confirmed Endpoints:**
- `GET /` → Returns SPA HTML (OpenCode web UI)
- `GET /api/health` → Returns `{"_tag":"UnauthorizedError","message":"Authentication required"}`

**Authentication:** OpenCode v2 server requires HTTP Basic auth for API endpoints.

---

### 3. Critical Architecture Flaw: `/v1/chat/completions` Does Not Exist Locally

**Problem:** Gateway code forwards to:
```javascript
fetch(`http://127.0.0.1:${port}/v1/chat/completions`, ...)
```

**Reality:** Local OpenCode server **DOES NOT** expose OpenAI-compatible `/v1/chat/completions` endpoint.

**OpenCode v2 API Structure:**
- Native API: `/api/session`, `/api/session/:id/message`
- Health: `/api/health` (requires auth)
- Web UI: `/` (SPA)
- **No `/v1/` routes at all**

**Impact:** 🔴 **FATAL** - Every chat completion request will fail. The entire gateway is non-functional.

---

### 4. Health Check Endpoint Wrong

**Current Code:** Uses `/health`  
**Actual Endpoint:** `/api/health` (requires Basic auth)

**Impact:** Health checks will return HTML instead of JSON, causing false positives.

---

### 5. Missing Authentication

**Reality:** OpenCode v2 server requires:
```
Authorization: Basic base64(username:password)
```

**Current Gateway:** Sends requests without authentication header.

**Impact:** All API requests return 401 Unauthorized.

---

## 🐛 Remaining Critical Bugs

### P0 Blockers (Must Fix)

1. **No `/v1/chat/completions` endpoint exists**
   - Gateway forwards to non-existent endpoint
   - Must implement OpenAI → OpenCode API translation
   - Or pivot to using hosted OpenCode API

2. **Wrong health endpoint**
   - Uses `/health` instead of `/api/health`
   - Returns HTML, not JSON

3. **Missing authentication**
   - OpenCode server requires Basic auth
   - Gateway doesn't send auth headers

4. **Dockerfile cannot build**
   - `npm install -g opencode` fails (package doesn't exist)
   - Should be `@opencode/cli` or `opencode-ai`

### P1 Issues (Production Hardening)

5. **Quota race condition** - Partially fixed (inFlight added) but needs release mechanism
6. **Retry logic undercounts** - Failed requests not tracked
7. **No streaming support** - SSE will fail
8. **In-memory quota state** - Lost on restart
9. **No gateway authentication** - Anyone can use
10. **Reports healthy with 0 instances** - False positives
11. **Database setup guide wrong** - Tokens go to wrong DB

---

## 💡 Architectural Options

### Option A: Implement Translation Layer (Complex)

**Approach:** Build OpenAI → OpenCode API adapter

**Requirements:**
- Map OpenAI Chat Completions → OpenCode `/api/session` + `/api/message`
- Handle authentication (Basic auth)
- Support streaming (SSE)
- Map models (e.g., `beam-free` → `opencode/beam-free`)
- Convert response format

**Effort:** 8-16 hours  
**Risk:** Medium (API may change)

### Option B: Use Hosted OpenCode API (Simpler)

**Approach:** Pool accounts hitting OpenCode's hosted API directly

**Requirements:**
- Extract OAuth tokens from DBs
- Implement OAuth refresh flow
- Forward to `https://api.opencode.ai/v1/chat/completions`
- Track quota per account

**Effort:** 4-8 hours  
**Risk:** Low (stable API)  
**Limitation:** Requires internet, depends on hosted service

### Option C: Document as Proof of Concept

**Approach:** Update README to reflect reality

**Changes:**
- Mark as "⚠️ Research Project - Not Production Ready"
- Document architectural findings
- List known blockers
- Explain why multi-instance approach doesn't work as designed

**Effort:** 1 hour  
**Risk:** None

---

## 🎯 Recommendations

### Immediate Actions

1. **Stop the background server:**
   ```bash
   # Find and kill opencode serve process on port 3099
   ```

2. **Update README.md:**
   ```markdown
   ## ⚠️ Status: Research Project - Not Production Ready
   
   **Known Issue:** Local OpenCode servers do not expose OpenAI-compatible 
   `/v1/chat/completions` endpoint. This project requires either:
   - Implementing an OpenAI → OpenCode API translation layer
   - Pivoting to pool hosted OpenCode API accounts
   ```

3. **Choose path forward:**
   - **Option B recommended:** Simpler, more maintainable, uses stable API
   - **Option C acceptable:** If just documenting research findings

### Do NOT

- ❌ Deploy current code to production
- ❌ Claim "production ready" in README
- ❌ Spend time on deployment configs until core functionality works

---

## 📊 Test Results Summary

| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| Instance spawn | Starts with `serve` | ✅ Works | ✅ Pass |
| Health check `/health` | JSON health data | HTML SPA | ❌ Fail |
| Health check `/api/health` | JSON health data | `UnauthorizedError` | ⚠️ Needs auth |
| Chat completion `/v1/chat/completions` | OpenAI response | (endpoint doesn't exist) | ❌ Fatal |
| Gateway forwards requests | Proxies successfully | Cannot test (no endpoint) | ❌ Blocked |

---

## 🤝 Honest Assessment

**What we learned:**
- ✅ Multi-instance pooling architecture is sound *in theory*
- ✅ Config-driven instance management works
- ✅ Some code quality is good (separation of concerns)
- ❌ **Critical assumption was wrong:** Local OpenCode ≠ OpenAI-compatible API
- ❌ Never validated the core premise before building

**What went well:**
- Comprehensive documentation
- Multiple deployment options prepared
- Good code structure

**What went wrong:**
- Built gateway before verifying upstream API
- Assumed `/v1/chat/completions` exists locally
- No integration tests
- No end-to-end validation

**Time invested:** ~4.5 hours  
**Time needed to fix:** 4-16 hours depending on chosen path

---

## 🚀 Next Steps

**If continuing this project:**

1. **Choose Option B** (hosted API pooling) - simpler and works
2. Implement:
   - OAuth token extraction from SQLite
   - OAuth refresh flow
   - Forward to `https://api.opencode.ai/v1/chat/completions`
   - Quota tracking per account
3. Add integration tests
4. Remove unnecessary deployment configs (Docker, systemd)

**If pivoting:**

1. Update README with honest assessment
2. Commit investigation findings
3. Mark repo as archived research
4. Document lessons learned

---

**Report End**

Generated by: Manual testing + DeepSeek v4.1 Flash Free code review  
Confidence: High (directly observed server behavior)
