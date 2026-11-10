# OpenCode Free Rotator

**Research project** to bypass OpenCode free tier 200 req/day limit through multi-account pooling.

## 🎯 Goal

Scale OpenCode free tier usage by rotating multiple accounts, similar to how `cockpit-tools-gateway` pools Kiro/Codex/Cursor accounts.

## 📊 OpenCode Free Tier Constraints

- **Limit:** 200 requests/day per account
- **Auth:** API key-based (not session-based like Kiro)
- **Models:** Big Pickle, Beam Free, and other free models
- **Window:** Daily quota reset (exact time TBD)

## 🔬 Research Questions

1. **Authentication:**
   - How are API keys stored locally in OpenCode?
   - Can we extract/manage multiple keys programmatically?
   - Is there a refresh token mechanism?

2. **Quota Tracking:**
   - How to track daily request count per account?
   - Does OpenCode API return quota usage in responses?
   - When exactly does quota reset?

3. **Account Rotation:**
   - Round-robin vs smart selection (lowest usage first)?
   - How to handle accounts that hit limit mid-request?
   - Failover strategy when all accounts exhausted?

4. **Storage Pattern:**
   - Store encrypted API keys like Kiro accounts?
   - Or plain keys with quota metadata?
   - How to sync with OpenCode's native storage?

## 🏗️ Architecture (Draft)

```
┌─────────────────────────────────────────┐
│  Client (OpenCode TUI / API)            │
└──────────────┬──────────────────────────┘
               │ HTTP Request
               ▼
┌─────────────────────────────────────────┐
│  Rotator Service                        │
│  - Select account with quota            │
│  - Track daily usage                    │
│  - Auto-rotation when limit hit         │
└──────────────┬──────────────────────────┘
               │ Forward with selected API key
         ┌─────┴─────┬─────────────┐
         ▼           ▼             ▼
    ┌────────┐  ┌────────┐   ┌────────┐
    │OpenCode│  │OpenCode│   │OpenCode│
    │ Free 1 │  │ Free 2 │   │ Free N │
    │150/200 │  │  5/200 │   │195/200 │
    └────────┘  └────────┘   └────────┘
```

## 📝 Implementation Plan

### Phase 1: Research (Current)
- [ ] Extract OpenCode API key storage location
- [ ] Understand OpenCode API authentication flow
- [ ] Test quota tracking with 1 account
- [ ] Document quota reset behavior

### Phase 2: Account Management
- [ ] Implement secure API key storage
- [ ] CLI to add/list/remove accounts
- [ ] Quota usage tracking per account
- [ ] Daily reset detection

### Phase 3: Rotation Logic
- [ ] Round-robin selector with quota awareness
- [ ] Automatic failover when account hits limit
- [ ] Health check endpoint
- [ ] Usage statistics

### Phase 4: Integration
- [ ] OpenAI-compatible proxy server
- [ ] Integrate with `cockpit-tools-gateway`
- [ ] OpenCode TUI integration
- [ ] Production deployment guide

## 🚧 Current Status

**Phase:** Research (Phase 1)

**Next Steps:**
1. Find where OpenCode stores API keys
2. Test OpenCode API directly with curl
3. Document response headers for quota info

## 📚 References

- [OpenCode Free Tier Docs](https://opencode.ai/docs/free)
- [OpenCode API Reference](https://docs.opencode.ai)
- Existing pooling patterns from `cockpit-tools-gateway`

## ⚠️ Important Notes

- This is a **research project** - approach may change as we learn
- OpenCode free tier is quota-based (not credit-based like Kiro)
- Need multiple OpenCode free accounts to test pooling
- Respect OpenCode ToS - rotation for legitimate scaling, not abuse

---

**Status:** 🔬 Research phase - defining scope and approach
