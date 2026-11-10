# API Gateway Comparison: OpenCode vs Kiro/Codex/Cursor

**Date:** 2026-11-10  
**Question:** OpenCode rotator vs Kiro/Codex/Cursor style rotation - which is easier for users?

---

## 🔍 Quick Answer

**For Personal Use:** Simple alias solution is easier  
**For Production API:** OpenCode needs more work than Kiro/Codex/Cursor  
**Why?** OAuth vs API keys

---

## 📊 Architecture Comparison

### Kiro/Codex/Cursor (Easy)

```
User Request
    ↓
Gateway (Simple)
    ├─ Load API key from config
    ├─ Round-robin selection
    ├─ Forward with Authorization: Bearer key1
    └─ On 429: Try key2
```

**Credential Type:** Static API keys  
**Storage:** JSON file or env vars  
**Rotation:** Simple round-robin  
**Setup Time:** 5 minutes  
**Complexity:** ⭐ Low

**Example Config:**
```json
{
  "providers": [
    {"key": "sk-proj-abc123...", "quota": 200},
    {"key": "sk-proj-def456...", "quota": 200},
    {"key": "sk-proj-ghi789...", "quota": 200}
  ]
}
```

**Gateway Logic:**
```javascript
// Simple!
const headers = {
  'Authorization': `Bearer ${currentAccount.key}`
};
```

---

### OpenCode (Complex)

```
User Request
    ↓
Gateway (Complex)
    ├─ Load OAuth tokens from DB
    ├─ Check token expiry (< 1h?)
    ├─ Auto-refresh if needed
    │   └─ POST /auth/token/refresh
    ├─ Translate OpenAI → OpenCode API
    │   └─ /v1/chat/completions → /api/session/:id/message
    └─ Forward with fresh token
```

**Credential Type:** OAuth 2.0 refresh tokens  
**Storage:** SQLite database  
**Rotation:** Needs token refresh logic  
**Setup Time:** 8-16 hours implementation  
**Complexity:** ⭐⭐⭐⭐⭐ High

**Credential Structure:**
```json
{
  "type": "oauth",
  "refresh": "rt_439e74e7a...",
  "access": "st_3dc589c6...",
  "expires": 1796398028784
}
```

**Gateway Logic:**
```javascript
// Complex!
// 1. Check expiry
if (Date.now() > account.expires - 3600000) {
  account = await refreshToken(account.refresh);
}

// 2. Translate API format
const openCodeRequest = translateOpenAIToOpenCode(openAIRequest);

// 3. Forward
const response = await fetch(openCodeUrl, {
  headers: { 'Authorization': `Bearer ${account.access}` },
  body: openCodeRequest
});

// 4. Translate response back
return translateOpenCodeToOpenAI(response);
```

---

## 🏗️ Implementation Comparison

### Kiro/Codex/Cursor Gateway

**Files needed:**
```
gateway/
├── config.json           # API keys (3 accounts)
├── server.js             # 200 lines
└── package.json
```

**Core Logic:**
```javascript
const accounts = loadConfig();
let currentIndex = 0;

app.post('/v1/chat/completions', async (req, res) => {
  const account = accounts[currentIndex];
  
  try {
    const response = await fetch('https://api.provider.com/v1/chat/completions', {
      headers: {
        'Authorization': `Bearer ${account.key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(req.body)
    });
    
    if (response.status === 429) {
      // Rotate
      currentIndex = (currentIndex + 1) % accounts.length;
      return retry();
    }
    
    return res.json(await response.json());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

**Time:** 1-2 hours  
**Lines:** ~200

---

### OpenCode Gateway (Current Project)

**Files needed:**
```
gateway/
├── config/
│   ├── accounts.json       # OAuth credentials
│   └── quota.json          # Usage tracking
├── src/
│   ├── InstanceManager.mjs # 300 lines
│   ├── Gateway.mjs         # 400 lines
│   ├── OAuthClient.mjs     # 200 lines (NEW)
│   ├── Translator.mjs      # 300 lines (NEW)
│   └── QuotaTracker.mjs    # 150 lines
├── docs/                   # 5 guides
└── package.json
```

**Core Logic:**
```javascript
// 1. OAuth Token Manager
class OAuthClient {
  async refreshToken(refreshToken) {
    const response = await fetch('https://api.opencode.ai/auth/token/refresh', {
      method: 'POST',
      body: JSON.stringify({ refresh_token: refreshToken })
    });
    return response.json();
  }
  
  async ensureValidToken(account) {
    if (Date.now() > account.expires - 3600000) {
      const fresh = await this.refreshToken(account.refresh);
      account.access = fresh.access_token;
      account.expires = Date.now() + fresh.expires_in * 1000;
      await this.saveAccount(account);
    }
    return account;
  }
}

// 2. API Translator
class APITranslator {
  translateRequest(openAIRequest) {
    // OpenAI format:
    // POST /v1/chat/completions
    // { messages: [...], model: "...", ... }
    
    // OpenCode format:
    // POST /api/session/:id/message
    // { content: "...", role: "user", ... }
    
    // Requires session creation first!
    // Complex multi-step translation
  }
  
  translateResponse(openCodeResponse) {
    // OpenCode format:
    // { id: "msg_...", content: [...], ... }
    
    // OpenAI format:
    // { choices: [{ message: {...} }], ... }
    
    // Complex mapping
  }
}

// 3. Main Gateway
app.post('/v1/chat/completions', async (req, res) => {
  const account = await accountPool.getNext();
  await oauthClient.ensureValidToken(account);
  
  // Translate OpenAI → OpenCode
  const openCodeRequest = translator.translateRequest(req.body);
  
  // Forward to OpenCode
  const response = await fetch(`http://127.0.0.1:${account.port}/api/session/${sessionId}/message`, {
    headers: {
      'Authorization': `Bearer ${account.access}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(openCodeRequest)
  });
  
  // Translate OpenCode → OpenAI
  const openAIResponse = translator.translateResponse(await response.json());
  
  res.json(openAIResponse);
});
```

**Time:** 8-16 hours  
**Lines:** ~1,350 (current) + ~500 (translation layer) = **~1,850 lines**

---

## 🎯 User Experience Comparison

### Scenario: User Wants 600 Req/Day

#### Option 1: Kiro/Codex/Cursor Style

**Setup:**
```bash
# 1. Get 3 API keys from provider
# 2. Create config
echo '{"keys":["sk-1","sk-2","sk-3"]}' > config.json

# 3. Start gateway
node gateway.js

# 4. Use it
curl http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"messages":[...]}'
```

**Time:** 5 minutes  
**User friction:** ⭐ Low  
**Works with:** Any OpenAI SDK

---

#### Option 2: OpenCode Gateway (Complex)

**Setup:**
```bash
# 1. Install & authenticate 3 accounts
opencode  # account1
OPENCODE_DB=db2.db opencode  # account2
OPENCODE_DB=db3.db opencode  # account3

# 2. Extract OAuth tokens from SQLite
node scripts/extract-tokens.js

# 3. Configure gateway
cp tokens.json config/accounts.json

# 4. Start gateway
node gateway.js

# 5. Use it
curl http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"messages":[...]}'
```

**Time:** 30 minutes + 8-16 hours gateway implementation  
**User friction:** ⭐⭐⭐⭐ High  
**Works with:** Any OpenAI SDK (after translation layer)

---

#### Option 3: OpenCode Simple (Alias)

**Setup:**
```bash
# 1. Authenticate 3 accounts
opencode  # account1
OPENCODE_DB=db2.db opencode  # account2
OPENCODE_DB=db3.db opencode  # account3

# 2. Create aliases
alias oc1='opencode'
alias oc2='OPENCODE_DB=db2.db opencode'
alias oc3='OPENCODE_DB=db3.db opencode'

# 3. Use it
oc1  # When quota hits, switch to:
oc2  # When quota hits, switch to:
oc3
```

**Time:** 5 minutes  
**User friction:** ⭐ Low  
**Works with:** OpenCode CLI only

---

## 📊 Comparison Matrix

| Feature | Kiro/Codex/Cursor | OpenCode Gateway | OpenCode Simple |
|---------|-------------------|------------------|-----------------|
| **Setup Time** | 5 min | 8-16h + 30 min | 5 min |
| **Implementation** | ✅ Standard | ❌ Custom needed | ✅ Built-in |
| **API Compatibility** | ✅ OpenAI SDK | ✅ OpenAI SDK* | ❌ CLI only |
| **Credential Type** | API keys | OAuth tokens | OAuth tokens |
| **Rotation Logic** | ✅ Simple | ⚠️ Complex | 🔄 Manual |
| **Token Refresh** | ❌ Not needed | ✅ Required | ✅ Auto |
| **Production Ready** | ✅ Yes | ⚠️ Needs work | ❌ Personal use |
| **User Friction** | ⭐ Low | ⭐⭐⭐⭐ High | ⭐ Low |
| **Maintenance** | ⭐ Easy | ⭐⭐⭐⭐ Hard | ⭐ Easy |

\* Requires translation layer implementation

---

## 🎓 Why Kiro/Codex/Cursor is Easier

### 1. Static API Keys vs OAuth

**Kiro/Codex/Cursor:**
```javascript
const key = "sk-proj-abc123..."; // Never expires (until revoked)
```

**OpenCode:**
```javascript
const token = await refreshIfExpired({
  access: "st_3dc589c6...",  // Expires in 30 days
  refresh: "rt_439e74e7a...", // Used to get new access token
  expires: 1796398028784
});
```

**Complexity:** OAuth is 10x more complex

---

### 2. Direct API vs Translation Layer

**Kiro/Codex/Cursor:**
```
Client → Gateway → Provider (same API format)
```

**OpenCode:**
```
Client (OpenAI) → Gateway → Translate → OpenCode → Translate ← Gateway ← Client
```

**Extra work:** Translation layer = 8-16 hours

---

### 3. Standard Protocol vs Custom

**Kiro/Codex/Cursor:**
- Uses standard OpenAI API format
- Drop-in replacement
- No custom logic needed

**OpenCode:**
- Custom API format (`/api/session/:id/message`)
- Requires session creation
- Stateful (session management)
- Needs bidirectional translation

---

## 💡 Which Approach for What?

### Use Kiro/Codex/Cursor Style When:
- ✅ Provider gives static API keys
- ✅ API format is standard (OpenAI-compatible)
- ✅ Need production API service
- ✅ Want easy setup (5 minutes)
- ✅ Multiple users/clients

**Examples:** OpenAI, Anthropic, Groq, Together AI, etc.

---

### Use OpenCode Gateway When:
- ⚠️ You have 8-16 hours to implement
- ⚠️ Need OpenAI SDK compatibility
- ⚠️ Production API service required
- ⚠️ Can maintain OAuth + translation logic
- ❌ Not recommended for personal use

---

### Use OpenCode Simple When:
- ✅ Personal machine only
- ✅ You control when to switch
- ✅ Don't need automation
- ✅ Want 5-minute setup
- ✅ OpenCode CLI is enough

**This is the recommended approach!** ⭐

---

## 🏆 Final Verdict

### For Users (Personal Use)

**Easiest Solution:**
```
OpenCode Simple (Alias) > Kiro/Codex Gateway > OpenCode Gateway
⭐ 5 min              ⭐ 5 min           ⭐⭐⭐⭐ 8-16h
```

**Why OpenCode Simple Wins:**
- Built-in feature (OPENCODE_DB)
- No gateway needed
- No OAuth complexity
- 5-minute setup
- 600+ req/day working

---

### For Production API Service

**Feasibility Ranking:**
```
Kiro/Codex Gateway > OpenCode Gateway
⭐⭐ Medium          ⭐⭐⭐⭐⭐ Very Hard
```

**Why Kiro/Codex Easier:**
- Standard API keys (no OAuth)
- Standard API format (no translation)
- 1-2 hours vs 8-16 hours
- Less maintenance

---

## 📝 Summary

**Your Question:** "Cách này có giống với dạng xoay như kiro/codex/cursor không? Dạng đó có dễ cho user hơn không nhỉ?"

**Answer:**

1. **Architecture:** ❌ Không giống
   - Kiro/Codex/Cursor: Static API keys
   - OpenCode: OAuth refresh tokens

2. **Complexity:** Kiro/Codex/Cursor **dễ hơn nhiều**
   - Setup: 5 min vs 8-16h
   - Implementation: 200 lines vs 1,850 lines
   - Maintenance: Easy vs Hard

3. **For Personal Use:** OpenCode Simple **thắng cả hai**
   - Không cần gateway
   - 5 phút setup
   - Built-in feature

4. **For Production:** Kiro/Codex style **dễ hơn**
   - Standard protocol
   - No translation needed
   - Less complexity

---

**Bản thiết kế gateway vẫn còn đầy đủ trong repo:**
- ✅ Architecture documents (5 guides)
- ✅ Implementation code (Phase 1-5)
- ✅ Deployment configs (systemd, PM2, Docker)
- ⚠️ Missing: OAuth refresh + Translation layer (8-16h)

**Recommendation:**
- Personal use: Use simple alias (5 min) ⭐
- Production: Use Kiro/Codex style if possible
- OpenCode gateway: Only if really needed (8-16h investment)

---

**Status:** Full comparison complete  
**Winner (Personal):** Simple alias  
**Winner (Production):** Kiro/Codex style  
**OpenCode Gateway:** Feasible but not worth it
