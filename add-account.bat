@echo off
setlocal EnableDelayedExpansion

:: OpenCode Account Manual Setup Helper
:: Opens PowerShell with correct OPENCODE_DB environment

echo.
echo ╔════════════════════════════════════════════════════════════╗
echo ║                                                            ║
echo ║  🚀 OpenCode Account Setup                                ║
echo ║                                                            ║
echo ╚════════════════════════════════════════════════════════════╝
echo.

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
echo ════════════════════════════════════════════════════════════
echo.
echo 📋 Instructions:
echo.
echo   1. A new PowerShell window will open
echo   2. Type: /connect
echo   3. Click the OAuth link that appears
echo   4. Login with your email
echo   5. Close PowerShell when done
echo   6. Come back here to verify!
echo.
echo ════════════════════════════════════════════════════════════
echo.
pause

:: Open new PowerShell with OPENCODE_DB set
if !SLOT! EQU 1 (
    start "OpenCode Account !SLOT!" powershell -NoExit -Command "Write-Host ''; Write-Host '═══════════════════════════════════════════════════' -ForegroundColor Cyan; Write-Host '  OpenCode Account !SLOT! Setup' -ForegroundColor Green; Write-Host '═══════════════════════════════════════════════════' -ForegroundColor Cyan; Write-Host ''; Write-Host 'Database: !DB_PATH!' -ForegroundColor Yellow; Write-Host ''; Write-Host 'Steps:' -ForegroundColor White; Write-Host '1. Type: /connect' -ForegroundColor Yellow; Write-Host '2. Click OAuth link → Login' -ForegroundColor Yellow; Write-Host '3. Close this window when done' -ForegroundColor Yellow; Write-Host ''; Write-Host '═══════════════════════════════════════════════════' -ForegroundColor Cyan; Write-Host ''; opencode"
) else (
    start "OpenCode Account !SLOT!" powershell -NoExit -Command "$env:OPENCODE_DB='!DB_PATH!'; Write-Host ''; Write-Host '═══════════════════════════════════════════════════' -ForegroundColor Cyan; Write-Host '  OpenCode Account !SLOT! Setup' -ForegroundColor Green; Write-Host '═══════════════════════════════════════════════════' -ForegroundColor Cyan; Write-Host ''; Write-Host 'Database: !DB_PATH!' -ForegroundColor Yellow; Write-Host ''; Write-Host 'Steps:' -ForegroundColor White; Write-Host '1. Type: /connect' -ForegroundColor Yellow; Write-Host '2. Click OAuth link → Login with DIFFERENT email' -ForegroundColor Yellow; Write-Host '3. Close this window when done' -ForegroundColor Yellow; Write-Host ''; Write-Host '═══════════════════════════════════════════════════' -ForegroundColor Cyan; Write-Host ''; opencode"
)

echo.
echo ⏳ Waiting for you to complete setup in the other window...
echo.
timeout /t 5 /nobreak >nul

:: Wait for credential to be saved
:CHECK_LOOP
timeout /t 3 /nobreak >nul

node scripts\check-credential.mjs !SLOT! "!DB_PATH!" >nul 2>&1
if %errorlevel% equ 0 (
    echo.
    echo ╔════════════════════════════════════════════════════════════╗
    echo ║                                                            ║
    echo ║  ✅ Account !SLOT! Added Successfully!                     ║
    echo ║                                                            ║
    echo ╚════════════════════════════════════════════════════════════╝
    echo.
    node scripts\list-accounts.mjs
    echo.
    goto END
)

:: Check if user closed the window
tasklist /FI "WINDOWTITLE eq OpenCode Account !SLOT!" 2>nul | find "powershell.exe" >nul
if %errorlevel% neq 0 (
    echo.
    echo ⚠️  Setup window closed. Checking if credential was saved...
    echo.
    node scripts\check-credential.mjs !SLOT! "!DB_PATH!" >nul 2>&1
    if %errorlevel% equ 0 (
        echo ✅ Credential found!
        echo.
        node scripts\list-accounts.mjs
        echo.
    ) else (
        echo ❌ Credential not found. Please try again.
        echo.
    )
    goto END
)

goto CHECK_LOOP

:END
pause
