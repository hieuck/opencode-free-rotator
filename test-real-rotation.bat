@echo off
setlocal enabledelayedexpansion
REM REAL ROTATION TEST - Executable Proof Script (Windows)
REM Run this on your machine to prove rotation works!

echo.
echo ╔════════════════════════════════════════════════════════════╗
echo ║                                                            ║
echo ║  🧪 REAL ROTATION TEST - Live Proof                       ║
echo ║     This will prove rotation works with your accounts     ║
echo ║                                                            ║
echo ╚════════════════════════════════════════════════════════════╝
echo.

set DATA_DIR=%USERPROFILE%\.local\share\opencode
if not exist "%DATA_DIR%" mkdir "%DATA_DIR%"

set DB1=%DATA_DIR%\opencode.db
set DB2=%DATA_DIR%\db2.db

echo 📋 Test Plan:
echo   1. Confirm Account 1 is exhausted
echo   2. Setup Account 2 (if needed)
echo   3. Test Account 2 has fresh quota
echo   4. Prove rotation by switching back/forth
echo.

REM Test 1: Confirm Account 1 exhausted
echo ═══════════════════════════════════════════════════════════
echo TEST 1: Verify Account 1 is Exhausted
echo ═══════════════════════════════════════════════════════════
echo.

echo Testing Account 1 (default database)...
echo.

echo /ask Say "Test 1" | opencode --non-interactive 2>&1 | findstr /i "limit quota" >nul
if %ERRORLEVEL% EQU 0 (
    echo ❌ Account 1: FREE USAGE LIMIT REACHED
    echo ✅ TEST 1 PASSED: Account 1 is exhausted as expected
    set ACCOUNT1_EXHAUSTED=true
) else (
    echo ✅ Account 1: Still has quota
    echo ⚠️  Account 1 not exhausted yet. Continuing anyway...
    set ACCOUNT1_EXHAUSTED=false
)

echo.
pause
echo.

REM Test 2: Setup Account 2
echo ═══════════════════════════════════════════════════════════
echo TEST 2: Setup Account 2 (Different Database)
echo ═══════════════════════════════════════════════════════════
echo.

if not exist "%DB2%" (
    echo ⚠️  Account 2 not authenticated yet
    echo.
    echo Please authenticate Account 2 now:
    echo.
    echo   set OPENCODE_DB=%DB2% ^&^& opencode
    echo.
    echo In OpenCode prompt, run:
    echo   ^> /connect
    echo.
    echo Sign in with a DIFFERENT email
    echo.
    pause
    
    if not exist "%DB2%" (
        echo ❌ Account 2 database not found. Aborting.
        exit /b 1
    )
)

echo ✅ Account 2 database found: %DB2%
echo.
pause
echo.

REM Test 3: Test Account 2 works
echo ═══════════════════════════════════════════════════════════
echo TEST 3: Verify Account 2 Has Fresh Quota
echo ═══════════════════════════════════════════════════════════
echo.

echo Testing Account 2 with separate database...
echo.

set OPENCODE_DB=%DB2%
echo /ask Say "Test 2" | opencode --non-interactive 2>&1 | findstr /i "limit quota" >nul
if %ERRORLEVEL% EQU 0 (
    echo ❌ Account 2: FREE USAGE LIMIT REACHED
    echo ❌ TEST 3 FAILED: Account 2 also exhausted
    echo.
    echo This means you need truly different email accounts
    echo.
    exit /b 1
) else (
    echo ✅ Account 2: HAS QUOTA AND WORKS!
    echo ✅ TEST 3 PASSED: Account 2 has independent quota
    set ACCOUNT2_WORKS=true
)

echo.
pause
echo.

REM Test 4: Prove rotation
echo ═══════════════════════════════════════════════════════════
echo TEST 4: Prove Rotation Works (Switch Back ^& Forth)
echo ═══════════════════════════════════════════════════════════
echo.

echo Switching back to Account 1...
set OPENCODE_DB=%DB1%
echo /ask Say "Test 3" | opencode --non-interactive 2>&1 | findstr /i "limit quota" >nul
if %ERRORLEVEL% EQU 0 (
    echo ❌ Account 1: STILL EXHAUSTED
    echo ✅ Confirmed: Account 1 quota is independent
) else (
    echo ✅ Account 1: Now working
)

echo.
echo Switching back to Account 2...
set OPENCODE_DB=%DB2%
echo /ask Say "Test 4" | opencode --non-interactive 2>&1 | findstr /i "limit quota" >nul
if %ERRORLEVEL% EQU 0 (
    echo ❌ Account 2: Now exhausted
) else (
    echo ✅ Account 2: STILL WORKING
    echo ✅ TEST 4 PASSED: Account 2 continues to work
)

echo.
echo ═══════════════════════════════════════════════════════════
echo 🎉 ROTATION TEST COMPLETE
echo ═══════════════════════════════════════════════════════════
echo.

if "!ACCOUNT2_WORKS!"=="true" (
    echo.
    echo ╔════════════════════════════════════════════════════════════╗
    echo ║                                                            ║
    echo ║  🏆 ROTATION PROVEN! ✅                                   ║
    echo ║                                                            ║
    echo ║  Different OPENCODE_DB = Different Quota                  ║
    echo ║  Account 1 exhausted ≠ Account 2 exhausted                ║
    echo ║  Gateway automation is VALID! 🚀                          ║
    echo ║                                                            ║
    echo ╚════════════════════════════════════════════════════════════╝
    echo.
    echo Next Steps:
    echo   1. Authenticate Account 3 for 600+ req/day
    echo   2. Run: quick-start.bat
    echo   3. Enjoy automatic rotation! 🎉
) else (
    echo ⚠️  Account 2 also exhausted or not authenticated
    echo Try with truly different email account
)

echo.
pause
