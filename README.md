# OpenCode Free Account Rotator

**Bypass OpenCode 200 req/day limit** bằng cách tự động xoay giữa nhiều free accounts!

## ✨ Features

- ✅ **Tự động xoay** giữa nhiều free accounts (mỗi account = 200 req/day)
- ✅ **Không cần Web UI** - chỉ thêm connection thủ công rồi để gateway tự động xoay
- ✅ **Tương thích với Kiro/Codex** - dùng như OpenCode API bình thường
- ✅ **Tự động tổ chức** credentials vào separate databases

## 📊 Current Setup

```
✅ Account 1: dungbanemok@gmail.com (200 req/day) - Port 3201
✅ Account 2: hieuck.dev@gmail.com (200 req/day) - Port 3202
📈 Total: 400 req/day

🔧 Gateway: http://localhost:3200
🎯 Port Range: 3201-3299 (supports up to 99 accounts!)
```

## 🚀 Quick Start

### 1. Thêm Accounts (Thao tác thủ công)

**Cách 1: Dùng OpenCode CLI thủ công**

```powershell
# Account 1 (opencode.db - mặc định)
opencode
# Gõ: /connect → Login với email 1

# Account 2 (db2.db)
$env:OPENCODE_DB="C:\Users\hieut\.local\share\opencode\db2.db"
opencode
# Gõ: /connect → Login với email 2 (KHÁC email 1!)

# Account 3 (db3.db) - Optional
$env:OPENCODE_DB="C:\Users\hieut\.local\share\opencode\db3.db"
opencode
# Gõ: /connect → Login với email 3
```

**Cách 2: Dùng helper script**

```bash
# Double-click add-account.bat
# Script sẽ tự động mở PowerShell với database đúng
# Bạn chỉ cần gõ /connect và login
```

### 2. Tự động tổ chức credentials

```bash
node scripts/organize-credentials.mjs
```

Script này sẽ:
- Tìm tất cả credentials từ tất cả databases
- Tách mỗi email vào database riêng
- Backup databases cũ trước khi sửa
- Report final setup

### 3. Start Gateway

```bash
node src/AccountManager.mjs
```

Gateway sẽ:
- Tự động detect accounts từ databases
- Spawn OpenCode server cho mỗi account
- Expose unified API endpoint trên port 3200
- Tự động xoay requests giữa accounts

### 4. Sử dụng

**Cấu hình Kiro/Codex:**

```json
{
  "providers": [
    {
      "id": "opencode-rotator",
      "baseUrl": "http://localhost:3200/v1"
    }
  ]
}
```

**Hoặc test trực tiếp:**

```bash
curl http://localhost:3200/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-4",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

## 📁 File Structure

```
.
├── src/
│   └── AccountManager.mjs      # Main gateway + server spawner
├── scripts/
│   ├── organize-credentials.mjs  # Auto-organize mixed credentials
│   ├── list-accounts.mjs         # List all accounts
│   ├── check-db.mjs              # Check database contents
│   └── check-credential.mjs      # Verify credential exists
├── add-account.bat             # Helper script for adding accounts
└── quick-test.mjs              # Test rotation
```

## 🔧 How It Works

1. **Multiple Databases**: Mỗi account = 1 database file riêng
   - `opencode.db` → Account 1
   - `db2.db` → Account 2
   - `db3.db` → Account 3
   - ... up to `db99.db` → Account 99

2. **Server per Account**: AccountManager spawn 1 OpenCode server per database
   - Server 1 → port 3201 (opencode.db)
   - Server 2 → port 3202 (db2.db)
   - Server 3 → port 3203 (db3.db)
   - ... automatically allocates ports 3201-3299

3. **Gateway Load Balancer**: AccountManager = gateway API
   - Gateway listens on port 3200 (fixed)
   - Round-robin giữa các servers
   - Tự động skip servers đã hết quota
   - Auto-kill và restart nếu port bị conflict

## 💡 Tips

### Thêm Account thứ 3 (600 req/day total)

```bash
# 1. Add connection với email thứ 3
$env:OPENCODE_DB="C:\Users\hieut\.local\share\opencode\db3.db"
opencode
# Gõ: /connect

# 2. Organize lại
node scripts/organize-credentials.mjs

# 3. Restart gateway
# (Kill process cũ, rồi start lại)
node src/AccountManager.mjs
```

### Kiểm tra accounts hiện tại

```bash
node scripts/list-accounts.mjs
```

### Backup databases trước khi sửa

```bash
# organize-credentials.mjs tự động backup vào:
C:\Users\hieut\.local\share\opencode\backup-{timestamp}/
```

## ⚠️ Lưu ý

1. **Mỗi database PHẢI có email KHÁC NHAU** - cùng email = cùng quota!
2. **Gateway phải chạy liên tục** để rotation hoạt động
3. **Quota reset 00:00 UTC mỗi ngày** - tất cả accounts reset cùng lúc
4. **Port conflicts**: Nếu ports 3200-3203 bị chiếm, sửa trong `AccountManager.mjs`

## 📈 Monitoring

Gateway log hiển thị:
- ✅ Server ready: Khi OpenCode server spawn thành công
- 📡 Request: Mỗi request đến và account nào xử lý
- ⚠️ Quota exhausted: Khi account hết quota
- ❌ All accounts exhausted: Khi tất cả accounts hết quota

## 🐛 Troubleshooting

**"All accounts exhausted"**
- Tất cả accounts đã hết 200 req/day
- Đợi đến 00:00 UTC để quota reset
- Hoặc thêm account thứ 3

**"Port already in use"**
- Có AccountManager đang chạy rồi
- Kill process: `taskkill /F /IM node.exe`
- Restart lại

**Server không spawn**
- Check database có credential không: `node scripts/check-db.mjs <path>`
- Check log trong console output

## 📝 License

MIT

## 🙏 Credits

Built with:
- OpenCode CLI
- better-sqlite3
- express
