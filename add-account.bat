@echo off
setlocal EnableDelayedExpansion

:: OpenCode Account Auto-Add Script
:: Double-click to add a new account automatically!

echo.
echo ╔════════════════════════════════════════════════════════════╗
echo ║                                                            ║
echo ║  🚀 OpenCode Account Auto-Add                             ║
echo ║                                                            ║
echo ╚════════════════════════════════════════════════════════════╝
echo.

:: Check if Node.js is available
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo ❌ Node.js not found! Please install Node.js first.
    pause
    exit /b 1
)

:: Find next available database slot
set SLOT=0
set DB_PATH=

if not exist "%USERPROFILE%\.local\share\opencode\opencode.db" (
    set SLOT=1
    set DB_PATH=%USERPROFILE%\.local\share\opencode\opencode.db
) else if not exist "%USERPROFILE%\.local\share\opencode\db2.db" (
    set SLOT=2
    set DB_PATH=%USERPROFILE%\.local\share\opencode\db2.db
) else if not exist "%USERPROFILE%\.local\share\opencode\db3.db" (
    set SLOT=3
    set DB_PATH=%USERPROFILE%\.local\share\opencode\db3.db
) else (
    echo ❌ All 3 account slots are already used!
    echo.
    echo Current accounts:
    node scripts\list-accounts.mjs
    echo.
    pause
    exit /b 1
)

echo 📊 Account Slot: !SLOT!
echo 💾 Database: !DB_PATH!
echo.

:: Run Node.js OAuth automation
echo 🔐 Starting OAuth flow...
echo.

node scripts\oauth-automation.mjs !SLOT! "!DB_PATH!"

if %errorlevel% equ 0 (
    echo.
    echo ╔════════════════════════════════════════════════════════════╗
    echo ║                                                            ║
    echo ║  ✅ Account Added Successfully!                           ║
    echo ║                                                            ║
    echo ╚════════════════════════════════════════════════════════════╝
    echo.
    echo 🎉 You can now use this account in OpenCode!
    echo.
) else (
    echo.
    echo ❌ Failed to add account!
    echo.
)

pause
