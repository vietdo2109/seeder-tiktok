@echo off
setlocal enabledelayedexpansion

set "CHROME=C:\Program Files\Google\Chrome\Application\chrome.exe"
set "BASE_PROFILE_DIR=C:\ChromeProfiles"
set "COMMON_FLAGS=--disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows --remote-allow-origins=* --disable-popup-blocking --no-first-run --disk-cache-size=104857600 --media-cache-size=104857600"

if not exist "%CHROME%" (
    echo ERROR: Chrome not found at %CHROME%
    exit /b 1
)

if not exist "%BASE_PROFILE_DIR%" (
    mkdir "%BASE_PROFILE_DIR%"
    echo Created base profile directory: %BASE_PROFILE_DIR%
)

echo Killing all running chrome.exe processes (clean slate)...
taskkill /f /im chrome.exe >nul 2>&1
timeout /t 2 /nobreak >nul

for /L %%i in (1,1,10) do (
    set "PROFILE_DIR=%BASE_PROFILE_DIR%\Profile%%i"
    set /a PORT=9220+%%i

    if not exist "!PROFILE_DIR!" (
        mkdir "!PROFILE_DIR!"
        echo Created Profile%%i folder
    )

    echo Launching Profile%%i on port !PORT!
    start "" "%CHROME%" --remote-debugging-port=!PORT! --user-data-dir="!PROFILE_DIR!" %COMMON_FLAGS%
    timeout /t 2 /nobreak >nul
)

echo All Chrome profiles launched successfully.
