# Deployment Guide

Complete guide for deploying OpenCode Free Rotator to production.

## Deployment Methods

- [systemd (Linux)](#systemd-linux)
- [PM2 (Cross-platform)](#pm2-cross-platform)
- [Docker](#docker)
- [Docker Compose](#docker-compose-recommended)

---

## systemd (Linux)

Best for: Dedicated Linux servers, VPS

### 1. Setup Application

```bash
# Clone repository
git clone https://github.com/yourusername/opencode-free-rotator.git
cd opencode-free-rotator

# Install dependencies
npm install

# Setup accounts (see docs/SETUP_GUIDE.md)
# Configure
cp config.example.yaml config.yaml
nano config.yaml
```

### 2. Install Service

```bash
# Edit service file
nano deployment/opencode-rotator.service

# Update these fields:
# - User=your-username
# - WorkingDirectory=/path/to/opencode-free-rotator
# - ExecStart=/usr/bin/node server.mjs

# Copy to systemd
sudo cp deployment/opencode-rotator.service /etc/systemd/system/

# Reload systemd
sudo systemctl daemon-reload
```

### 3. Enable and Start

```bash
# Enable auto-start on boot
sudo systemctl enable opencode-rotator

# Start service
sudo systemctl start opencode-rotator

# Check status
sudo systemctl status opencode-rotator
```

### 4. Manage Service

```bash
# View logs
journalctl -u opencode-rotator -f

# Restart
sudo systemctl restart opencode-rotator

# Stop
sudo systemctl stop opencode-rotator

# Disable auto-start
sudo systemctl disable opencode-rotator
```

### Troubleshooting

**Service fails to start:**
```bash
# Check logs
journalctl -u opencode-rotator -n 50

# Common issues:
# - Wrong user/paths in service file
# - Missing config.yaml
# - Port already in use
```

---

## PM2 (Cross-platform)

Best for: Development servers, Node.js environments

### 1. Install PM2

```bash
npm install -g pm2
```

### 2. Setup Application

```bash
# Clone and install
git clone https://github.com/yourusername/opencode-free-rotator.git
cd opencode-free-rotator
npm install

# Configure
cp config.example.yaml config.yaml
nano config.yaml
```

### 3. Start with PM2

**Option A: Simple start**
```bash
pm2 start server.mjs --name opencode-rotator
```

**Option B: Using ecosystem file**
```bash
pm2 start deployment/ecosystem.config.cjs
```

### 4. Enable Auto-Start

```bash
# Generate startup script
pm2 startup

# Run the command it outputs (with sudo)
# Example: sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u youruser --hp /home/youruser

# Save current process list
pm2 save
```

### 5. Manage with PM2

```bash
# View status
pm2 status

# View logs
pm2 logs opencode-rotator

# Monitor resources
pm2 monit

# Restart
pm2 restart opencode-rotator

# Stop
pm2 stop opencode-rotator

# Delete
pm2 delete opencode-rotator
```

### PM2 Web Dashboard (Optional)

```bash
# Install PM2 Plus
pm2 install pm2-web

# Access at http://localhost:9615
```

---

## Docker

Best for: Containerized environments, Kubernetes

### 1. Build Image

```bash
# Clone repository
git clone https://github.com/yourusername/opencode-free-rotator.git
cd opencode-free-rotator

# Build image
docker build -t opencode-rotator .
```

### 2. Prepare Data

```bash
# Create data directory for SQLite databases
mkdir -p data/opencode

# Setup accounts on host first
# Then copy databases to data/opencode/
cp ~/.local/share/opencode/db*.db data/opencode/
```

### 3. Run Container

```bash
docker run -d \
  --name opencode-rotator \
  -p 20130:20130 \
  -p 3001-3003:3001-3003 \
  -v $(pwd)/data/opencode:/root/.local/share/opencode \
  -v $(pwd)/config.yaml:/app/config.yaml:ro \
  --restart unless-stopped \
  opencode-rotator
```

### 4. Manage Container

```bash
# View logs
docker logs -f opencode-rotator

# Check health
docker ps
docker inspect opencode-rotator | grep -A 5 Health

# Restart
docker restart opencode-rotator

# Stop
docker stop opencode-rotator

# Remove
docker rm opencode-rotator
```

---

## Docker Compose (Recommended)

Best for: Production Docker deployments

### 1. Setup

```bash
# Clone repository
git clone https://github.com/yourusername/opencode-free-rotator.git
cd opencode-free-rotator

# Create data directory
mkdir -p data/opencode

# Setup accounts and copy databases
# (See docs/SETUP_GUIDE.md)
cp ~/.local/share/opencode/db*.db data/opencode/

# Configure
cp config.example.yaml config.yaml
nano config.yaml
```

### 2. Deploy

```bash
# Build and start
docker-compose up -d

# View logs
docker-compose logs -f

# Check status
docker-compose ps
```

### 3. Manage

```bash
# Stop
docker-compose stop

# Restart
docker-compose restart

# Update after code changes
docker-compose down
docker-compose build
docker-compose up -d

# Remove everything
docker-compose down -v
```

### 4. Health Monitoring

```bash
# Check health endpoint
curl http://localhost:20130/health

# Check container health
docker-compose ps
# Should show "healthy" status
```

---

## Reverse Proxy (Optional)

Add SSL and domain name with nginx or Caddy.

### nginx

```nginx
server {
    listen 80;
    server_name rotator.yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:20130;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### Caddy

```
rotator.yourdomain.com {
    reverse_proxy 127.0.0.1:20130
}
```

---

## Monitoring

### Health Checks

**Manual check:**
```bash
curl http://localhost:20130/health
```

**Automated monitoring:**
```bash
# Add to crontab
*/5 * * * * curl -f http://localhost:20130/health || systemctl restart opencode-rotator
```

### Uptime Monitoring Services

- [UptimeRobot](https://uptimerobot.com/) - Free monitoring
- [Pingdom](https://www.pingdom.com/)
- [Better Uptime](https://betteruptime.com/)

Configure to check: `http://your-server:20130/health`

### Log Monitoring

**systemd:**
```bash
journalctl -u opencode-rotator -f
```

**PM2:**
```bash
pm2 logs opencode-rotator
```

**Docker:**
```bash
docker-compose logs -f
```

---

## Backup

### What to Backup

1. **SQLite databases** - OAuth tokens
   ```bash
   tar -czf opencode-backup-$(date +%Y%m%d).tar.gz \
     ~/.local/share/opencode/db*.db \
     config.yaml
   ```

2. **Configuration**
   ```bash
   cp config.yaml config.yaml.backup
   ```

### Restore

```bash
# Extract backup
tar -xzf opencode-backup-20261110.tar.gz

# Copy databases
cp db*.db ~/.local/share/opencode/

# Restart service
sudo systemctl restart opencode-rotator
# OR
pm2 restart opencode-rotator
```

---

## Security Considerations

### Network

- ✅ Bind gateway to `127.0.0.1` (localhost only)
- ✅ Use reverse proxy for external access
- ✅ Enable SSL/TLS on reverse proxy
- ❌ Don't expose gateway directly to internet

### Firewall

```bash
# Allow only necessary ports
sudo ufw allow 22/tcp   # SSH
sudo ufw allow 80/tcp   # HTTP (reverse proxy)
sudo ufw allow 443/tcp  # HTTPS (reverse proxy)
sudo ufw enable
```

### Access Control

If adding authentication:
```yaml
gateway:
  auth:
    enabled: true
    apiKeys:
      - "your-secure-api-key-here"
```

---

## Performance Tuning

### Resource Limits

**systemd:**
```ini
[Service]
MemoryMax=4G
CPUQuota=200%
```

**Docker Compose:**
```yaml
deploy:
  resources:
    limits:
      cpus: '2'
      memory: 4G
```

### Node.js Optimization

```bash
# Increase max old space size
NODE_OPTIONS="--max-old-space-size=4096" node server.mjs
```

---

## Troubleshooting

### High Memory Usage

**Solution:** Increase swap or add more RAM
```bash
# Check memory
free -h

# Add swap (if needed)
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

### Port Conflicts

**Solution:** Change ports in config.yaml
```yaml
gateway:
  port: 20131  # Changed from 20130

instances:
  - port: 3011  # Changed from 3001
```

### Database Locked

**Solution:** Stop all instances accessing the DB
```bash
# Find processes
lsof ~/.local/share/opencode/db1.db

# Kill if needed
kill -9 <PID>
```

---

## Production Checklist

Before going live:

- [ ] Accounts setup (3+ free accounts)
- [ ] OAuth authenticated for each account
- [ ] config.yaml configured correctly
- [ ] Service starts successfully
- [ ] Health endpoint returns 200
- [ ] Test request completes successfully
- [ ] Auto-restart configured
- [ ] Logs being captured
- [ ] Monitoring setup
- [ ] Backup strategy in place
- [ ] Firewall configured
- [ ] Reverse proxy (if external access)
- [ ] SSL certificate (if external access)

---

**Ready for production deployment!** 🚀
