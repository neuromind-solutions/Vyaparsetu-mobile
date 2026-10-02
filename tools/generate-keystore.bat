@echo off
setlocal
echo =======================================================
echo   VyapaarSetu Android Production Keystore Generator
echo =======================================================
echo.
set KEYSTORE_NAME=vyaparsetu-release.jks
set KEY_ALIAS=vyaparsetu

if exist "%KEYSTORE_NAME%" (
    echo [!] %KEYSTORE_NAME% already exists in current folder.
    echo Please backup or remove it before generating a new one.
    pause
    exit /b 1
)

echo Generating 2048-bit RSA release signing key...
keytool -genkeypair -v -keystore "%KEYSTORE_NAME%" -alias %KEY_ALIAS% -keyalg RSA -keysize 2048 -validity 10000

if %ERRORLEVEL% EQU 0 (
    echo.
    echo =======================================================
    echo [OK] Keystore created successfully: %KEYSTORE_NAME%
    echo Alias: %KEY_ALIAS%
    echo.
    echo To use in GitHub Actions:
    echo 1. Run in PowerShell:
    echo    [Convert]::ToBase64String([IO.File]::ReadAllBytes("%KEYSTORE_NAME%")) ^| Set-Clipboard
    echo 2. Go to GitHub Repo ^> Settings ^> Secrets and variables ^> Actions
    echo 3. Add Secret: KEYSTORE_BASE64 (paste from clipboard)
    echo 4. Add Secret: KEYSTORE_PASSWORD (your password)
    echo 5. Add Secret: KEY_ALIAS (%KEY_ALIAS%)
    echo 6. Add Secret: KEY_PASSWORD (your password)
    echo =======================================================
) else (
    echo.
    echo [ERROR] Keystore generation failed. Ensure JDK/keytool is installed in PATH.
)
pause
