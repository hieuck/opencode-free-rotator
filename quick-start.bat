@echo off
REM One-Command Setup - OpenCode Free Rotator (Windows)
REM Usage: quick-start.bat

echo.
echo ╔════════════════════════════════════════════════════════════╗
echo ║                                                            ║
echo ║  🚀 OpenCode Free Rotator - Quick Start                   ║
echo ║     End-to-End Setup in One Command                       ║
echo ║                                                            ║
echo ╚════════════════════════════════════════════════════════════╝
echo.

REM Check OpenCode
echo 📋 Step 1/5: Checking OpenCode installation...
where opencode >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo ❌ OpenCode not found
    echo.
    echo Please install OpenCode first:
    echo   npm install -g opencode
    echo.
    echo Or visit: https://opencode.ai
    exit /b 1
)
echo ✅ OpenCode found
echo.

REM Check Node.js
echo 📋 Step 2/5: Checking Node.js...
where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo ❌ Node.js not found
    echo Please install Node.js v18+ first
    exit /b 1
)
for /f "tokens=*" %%i in ('node --version') do set NODE_VERSION=%%i
echo ✅ Node.js found: %NODE_VERSION%
echo.

REM Install dependencies
echo 📋 Step 3/5: Installing dependencies...
if not exist "node_modules" (
    call npm install
)
echo ✅ Dependencies installed
echo.

REM Check accounts
echo 📋 Step 4/5: Checking account authentication...
set DATA_DIR=%USERPROFILE%\.local\share\opencode
if not exist "%DATA_DIR%" mkdir "%DATA_DIR%"

set DB1=%DATA_DIR%\opencode.db
set DB2=%DATA_DIR%\db2.db
set DB3=%DATA_DIR%\db3.db

set ACCOUNTS_READY=0

if exist "%DB1%" (
    echo ✅ Account 1: Authenticated
    set /a ACCOUNTS_READY+=1
) else (
    echo ⚠️  Account 1: Not authenticated
)

if exist "%DB2%" (
    echo ✅ Account 2: Authenticated
    set /a ACCOUNTS_READY+=1
) else (
    echo ⚠️  Account 2: Not authenticated
)

if exist "%DB3%" (
    echo ✅ Account 3: Authenticated
    set /a ACCOUNTS_READY+=1
) else (
    echo ⚠️  Account 3: Not authenticated
)

echo.
echo 📊 Accounts Ready: %ACCOUNTS_READY%/3
echo.

if %ACCOUNTS_READY% EQU 0 (
    echo ❌ No accounts authenticated!
    echo.
    echo Please authenticate at least one account:
    echo.
    echo   # Account 1
    echo   opencode
    echo   ^> /connect
    echo.
    echo   # Account 2
    echo   set OPENCODE_DB=%DATA_DIR%\db2.db ^&^& opencode
    echo   ^> /connect
    echo.
    echo   # Account 3
    echo   set OPENCODE_DB=%DATA_DIR%\db3.db ^&^& opencode
    echo   ^> /connect
    echo.
    echo Then run this script again!
    exit /b 1
)

if %ACCOUNTS_READY% LSS 3 (
    set /a TOTAL_QUOTA=%ACCOUNTS_READY%*200
    echo ⚠️  Only %ACCOUNTS_READY%/3 accounts authenticated
    echo Gateway will work with %ACCOUNTS_READY% × 200 = !TOTAL_QUOTA! req/day
    echo.
    echo To add more accounts, authenticate them and restart
    echo.
    set /p CONTINUE="Continue with %ACCOUNTS_READY% account(s)? [Y/n] "
    if /i not "!CONTINUE!"=="Y" if /i not "!CONTINUE!"=="" exit /b 1
)

REM Start gateway
echo 📋 Step 5/5: Starting gateway...
echo.

node src\SimpleGateway.mjs
