# OpenCode Free Rotator - Usage Guide

Complete guide for running the gateway in production.

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Setup accounts (see SETUP_GUIDE.md)
# Create 3+ OpenCode free accounts with OAuth

# 3. Configure
cp config.example.yaml config.yaml
# Edit config.yaml with your account details

# 4. Start gateway
npm start
```

Gateway will be available at: `http://127.0.0.1:20130/v1/chat/completions`

## Usage

### Starting the Gateway

```bash
npm start
```

This will:
1. Start all enabled OpenCode instances
2. Wait for health checks
3. Start HTTP gateway on port 20130
4. Begin tracking quota usage
5. Schedule daily quota reset

Expected output:
```
╔═══════════════════════════════════════════════════════════╗
║        OpenCode Free Rotator Gateway                      ║
╚═══════════════════════════════════════════════════════════╝

✅ Loaded config with 3 instances

🚀 Starting OpenCode instances...

⏳ Starting: OpenCode Free 1 (user1@example.com)
   Port: 3001
   DB: /home/user/.local/share/opencode/db1.db
✅ Started: OpenCode Free 1

...

🌐 Gateway listening on http://127.0.0.1:20130
📊 Forwarding to 3 instances

⏰ Next quota reset: 2026-11-11T00:00:00.000Z (in 22 hours)
```

### Sending Requests

**OpenAI-compatible API:**

```bash
curl http://127.0.0.1:20130/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "beam-free",
    "messages": [
      {"role": "user", "content": "Hello!"}
    ]
  }'
```

**With authentication (if instances require):**

```bash
curl http://127.0.0.1:20130/v1/chat/completions \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "beam-free",
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

### Monitoring

**Check gateway health:**

```bash
curl http://127.0.0.1:20130/health
```

Response:
```json
{
  "status": "ok",
  "gateway": {
    "running": 3,
    "total": 3
  },
  "instances": [
    {
      "name": "OpenCode Free 1",
      "running": true,
      "quota": "45/200"
    },
    ...
  ]
}
```

**Check detailed status:**

```bash
curl http://127.0.0.1:20130/status
```

**Instance status (CLI):**

```bash
npm run instances:status
```

### Managing Instances

**Manually stop instances:**
```bash
npm run instances:stop
```

**Manually reset quota:**
```bash
npm run instances:reset-quota
```

## Configuration

Edit `config.yaml`:

### Instance Selection Strategy

```yaml
gateway:
  selectionStrategy: "lowest-usage"  # or "round-robin"
```

**lowest-usage (recommended):**
- Always picks instance with least requests today
- Balances load evenly
- Maximizes available quota

**round-robin:**
- Simple rotation through available instances
- Ignores current usage
- Faster selection (no sorting)

### Quota Reset Time

```yaml
gateway:
  quotaResetHour: 0  # UTC hour (0-23)
```

Default: `0` (midnight UTC)

Adjust if OpenCode resets quota at different time.

### Request Timeout

```yaml
gateway:
  requestTimeout: 60000  # milliseconds
```

Increase for long-running requests (streaming, large outputs).

### Retry Behavior

```yaml
gateway:
  retryOnFailure: true
  maxRetries: 3
```

- `true`: Retry with next instance on failure
- `false`: Fail immediately on first error

## Request Flow

```
1. Client sends request → Gateway (port 20130)
   ↓
2. Gateway selects instance with quota
   - Strategy: lowest-usage or round-robin
   - Skip instances at 200/200
   ↓
3. Gateway forwards to instance (e.g., port 3001)
   ↓
4. Instance calls OpenCode API with its OAuth token
   ↓
5. Gateway increments request count
   ↓
6. Gateway returns response to client
```

**If instance fails:**
- Gateway retries with next instance (if `retryOnFailure: true`)
- Max `maxRetries` attempts
- Returns 503 if all instances fail

**If all quota exhausted:**
- Gateway returns 429 "quota_exhausted"
- Wait for daily reset (midnight UTC)

## Logging

Gateway logs each request:

```
✅ [OpenCode Free 1] beam-free - 1234ms
✅ [OpenCode Free 2] beam-free - 987ms
⚠️  Instance OpenCode Free 3 quota exceeded, trying next...
✅ [OpenCode Free 1] beam-free - 1100ms
```

Disable in config:
```yaml
logging:
  logRequests: false
```

## Production Deployment

### systemd Service (Linux)

Create `/etc/systemd/system/opencode-rotator.service`:

```ini
[Unit]
Description=OpenCode Free Rotator Gateway
After=network.target

[Service]
Type=simple
User=your-user
WorkingDirectory=/path/to/opencode-free-rotator
ExecStart=/usr/bin/node server.mjs
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl enable opencode-rotator
sudo systemctl start opencode-rotator
sudo systemctl status opencode-rotator
```

### PM2 (Cross-platform)

```bash
# Install PM2
npm install -g pm2

# Start gateway
pm2 start server.mjs --name opencode-rotator

# Auto-start on boot
pm2 startup
pm2 save

# Monitor
pm2 monit
pm2 logs opencode-rotator
```

### Docker

```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 20130

CMD ["node", "server.mjs"]
```

Build and run:
```bash
docker build -t opencode-rotator .
docker run -p 20130:20130 -v ~/.local/share/opencode:/root/.local/share/opencode opencode-rotator
```

## Troubleshooting

### Gateway won't start

**Check instances status:**
```bash
npm run instances:status
```

**Start instances manually:**
```bash
npm run instances:start
```

**Check logs:**
```bash
# If using PM2
pm2 logs opencode-rotator

# If using systemd
journalctl -u opencode-rotator -f
```

### All quota exhausted

**Symptom:** Gateway returns 429 "quota_exhausted"

**Solutions:**
1. Wait for daily reset (midnight UTC)
2. Add more instances (accounts)
3. Manually reset quota:
   ```bash
   npm run instances:reset-quota
   ```

### Instance not responding

**Check instance health:**
```bash
curl http://127.0.0.1:3001/health
curl http://127.0.0.1:3002/health
```

**Restart instances:**
```bash
npm run instances:stop
npm run instances:start
```

### High latency

**Symptoms:** Requests taking 10+ seconds

**Causes:**
- Instance overloaded
- Network issues
- Model processing time

**Solutions:**
1. Add more instances
2. Increase `requestTimeout` in config
3. Use faster models

## Scaling

### Adding More Accounts

1. Create new OpenCode account
2. Setup OAuth (see SETUP_GUIDE.md)
3. Add to `config.yaml`:
   ```yaml
   instances:
     - name: "OpenCode Free 4"
       email: "user4@example.com"
       port: 3004
       db: "~/.local/share/opencode/db4.db"
       quotaPerDay: 200
       enabled: true
   ```
4. Restart gateway

### Quota Calculation

**Daily quota per account:** 200 requests

**Total daily quota:**
- 3 accounts = 600 requests/day
- 5 accounts = 1,000 requests/day
- 10 accounts = 2,000 requests/day

**Hourly rate (distributed):**
- 600/day = ~25 req/hour
- 1,000/day = ~42 req/hour
- 2,000/day = ~83 req/hour

## Integration

### Use with LangChain

```javascript
import { ChatOpenAI } from "@langchain/openai";

const model = new ChatOpenAI({
  modelName: "beam-free",
  openAIApiKey: "not-needed",
  configuration: {
    baseURL: "http://127.0.0.1:20130/v1",
  },
});

const response = await model.invoke("Hello!");
```

### Use with OpenAI SDK

```javascript
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: "not-needed",
  baseURL: "http://127.0.0.1:20130/v1",
});

const completion = await client.chat.completions.create({
  model: "beam-free",
  messages: [{ role: "user", content: "Hello!" }],
});
```

### Use with curl

```bash
curl http://127.0.0.1:20130/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "beam-free",
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

---

**Gateway ready for production use!** 🎉
