@echo off
REM OpenCode Account Rotator - Windows Personal Use
REM Usage: opencode-rotate.bat

SET ACCOUNT_FILE=%USERPROFILE%\.opencode-current-account

REM Read current account (default: 1)
IF EXIST "%ACCOUNT_FILE%" (
  SET /p CURRENT=<"%ACCOUNT_FILE%"
) ELSE (
  SET CURRENT=1
)

REM Account details
IF "%CURRENT%"=="1" (
  SET DB=%USERPROFILE%\.local\share\opencode\opencode.db
  SET NAME=Account 1
  SET NEXT=2
)
IF "%CURRENT%"=="2" (
  SET DB=%USERPROFILE%\.local\share\opencode\db2.db
  SET NAME=Account 2
  SET NEXT=3
)
IF "%CURRENT%"=="3" (
  SET DB=%USERPROFILE%\.local\share\opencode\db3.db
  SET NAME=Account 3
  SET NEXT=1
)

echo.
echo 🔄 Using: %NAME%
echo 📊 Database: %DB%
echo.

REM Run OpenCode
SET OPENCODE_DB=%DB%
opencode %*

REM Check if failed (quota exceeded?)
IF ERRORLEVEL 1 (
  echo.
  echo ⚠️  Command failed. Rotating to next account...
  echo %NEXT% > "%ACCOUNT_FILE%"
  echo ➡️  Switched to: Account %NEXT%
  echo.
  echo Run command again to use new account.
) ELSE (
  echo.
  echo ✅ Success with %NAME%
)
