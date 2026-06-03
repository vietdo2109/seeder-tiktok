@echo off
cd /d "%~dp0"
echo Starting Chrome Seeder UI...
call npx electron .
if errorlevel 1 (
  echo.
  echo Something went wrong. Check the error above.
  pause
) else (
  pause
)
