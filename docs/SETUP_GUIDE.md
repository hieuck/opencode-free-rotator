# Setup Guide: OpenCode Free Rotator

This guide walks you through setting up multiple OpenCode free accounts for pooling.

## Prerequisites

- Node.js 18+ installed
- OpenCode CLI installed (`npm install -g opencode`)
- 3+ email accounts (Gmail, Outlook, etc.)
- ~1.5 GB RAM available

## Step 1: Create OpenCode Free Accounts

You need **3 or more** separate OpenCode free accounts.

### Create Account 1

1. **Start OpenCode with separate database:**
   ```bash
   OPENCODE_DB=~/.local/share/opencode/db1.db opencode server --port 3001
   ```

2. **Open OpenCode TUI in another terminal:**
   ```bash
   opencode
   ```

3. **Connect first account:**
   ```bash
   /connect
   # Select "OpenCode" from the list
   # Browser will open - sign in with your first email
   # Complete OAuth flow
   ```

4. **Verify authentication:**
   ```bash
   # Check that credential is saved
   node scripts/inspect-credentials.mjs
   # Should show your account email
   ```

5. **Stop the server:** Press Ctrl+C in the server terminal

### Create Account 2

1. **Start OpenCode with different database:**
   ```bash
   OPENCODE_DB=~/.local/share/opencode/db2.db opencode server --port 3002
   ```

2. **Connect second account:**
   ```bash
   /connect
   # Select "OpenCode"
   # Sign in with your SECOND email (different from account 1)
   ```

3. **Stop the server:** Ctrl+C

### Create Account 3 (and more)

Repeat the process with:
- `db3.db`, port `3003`, third email
- `db4.db`, port `3004`, fourth email
- etc.

**Important:** Each account MUST have:
- ✅ Separate database file (`dbN.db`)
- ✅ Separate port (`300N`)
- ✅ Different email address
- ✅ Completed OAuth authentication

## Step 2: Configure the Rotator

1. **Copy example config:**
   ```bash
   cp config.example.yaml config.yaml
   ```

2. **Edit `config.yaml`:**
   ```yaml
   instances:
     - name: "OpenCode Free 1"
       email: "your-actual-email-1@gmail.com"  # ← Your real email
       port: 3001
       db: "~/.local/share/opencode/db1.db"
       quotaPerDay: 200
       enabled: true
     
     - name: "OpenCode Free 2"
       email: "your-actual-email-2@gmail.com"  # ← Your real email
       port: 3002
       db: "~/.local/share/opencode/db2.db"
       quotaPerDay: 200
       enabled: true
     
     # Add more instances as needed
   ```

3. **Verify database paths exist:**
   ```bash
   ls ~/.local/share/opencode/db*.db
   # Should show: db1.db, db2.db, db3.db, ...
   ```

## Step 3: Test Instance Manager

1. **Check instance status:**
   ```bash
   node cli.mjs status
   ```
   Output:
   ```
   📊 Instance Status:
   
   Total Instances: 3
   Running: 0
   
   ⏹️ OpenCode Free 1
      Email: your-email-1@gmail.com
      Port: 3001
   ```

2. **Start all instances:**
   ```bash
   node cli.mjs start
   ```
   
   Expected output:
   ```
   🚀 Starting OpenCode instances...
   
   ⏳ Starting: OpenCode Free 1 (your-email-1@gmail.com)
      Port: 3001
      DB: /home/user/.local/share/opencode/db1.db
   ✅ Started: OpenCode Free 1
   
   ⏳ Starting: OpenCode Free 2 (your-email-2@gmail.com)
      Port: 3002
      DB: /home/user/.local/share/opencode/db2.db
   ✅ Started: OpenCode Free 2
   
   📊 Start Summary:
     ✅ OpenCode Free 1: started
     ✅ OpenCode Free 2: started
   
   ✅ All instances running. Press Ctrl+C to stop.
   ```

3. **In another terminal, check status:**
   ```bash
   node cli.mjs status
   ```
   
   Should show all instances **running** with quota `0/200`.

4. **Test instance selection:**
   ```bash
   node cli.mjs test-select
   ```
   
   Output:
   ```
   🧪 Testing instance selection...
   
   ✅ Selected: OpenCode Free 1
      Port: 3001
      Usage: 0/200
   ```

## Step 4: Verify Instance Health

Check each instance is responding:

```bash
# Instance 1
curl http://127.0.0.1:3001/health

# Instance 2
curl http://127.0.0.1:3002/health

# Instance 3
curl http://127.0.0.1:3003/health
```

Each should return:
```json
{
  "status": "ok",
  "version": "...",
  "uptime": ...
}
```

## Troubleshooting

### Instance won't start

**Error:** `Failed to start OpenCode Free 1: did not become healthy`

**Solutions:**
1. Check if port is already in use:
   ```bash
   netstat -ano | findstr :3001
   ```
2. Verify database path exists
3. Check OpenCode is installed: `which opencode`
4. Start instance manually to see errors:
   ```bash
   OPENCODE_DB=~/.local/share/opencode/db1.db opencode server --port 3001
   ```

### Authentication not found

**Error:** No credential in database

**Solution:** Re-run OAuth authentication:
```bash
OPENCODE_DB=~/.local/share/opencode/db1.db opencode server --port 3001
# Then in another terminal:
opencode
/connect
# Complete OAuth flow
```

### Port conflict

**Error:** `EADDRINUSE: address already in use`

**Solution:** 
1. Stop conflicting process:
   ```bash
   # Find PID
   netstat -ano | findstr :3001
   # Kill process
   taskkill /PID <pid> /F
   ```
2. Or use different port in config

### Database locked

**Error:** `database is locked`

**Solution:** Only ONE OpenCode process can access each database at a time. Make sure:
- No manual OpenCode server running on that DB
- No OpenCode TUI connected to that DB
- Instance manager is the only process accessing the DB

## Next Steps

Once all instances are running:

1. **Phase 4:** Implement gateway proxy (HTTP server)
2. **Test end-to-end:** Send requests to gateway, verify forwarding
3. **Production:** Run as system service (systemd/PM2)

## Resource Usage

**Per instance:**
- RAM: ~200-500 MB
- Disk: ~50 MB (SQLite + cache)
- CPU: Idle ~1%, Active ~5-10%

**For 3 instances:**
- Total RAM: ~1.5 GB
- Total disk: ~150 MB
- Ports: 3001-3003 + 20130 (gateway)

---

**Ready for Phase 4!** Instance manager is complete and tested. 🎉
