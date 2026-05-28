@echo off
setlocal

cd /d "%~dp0"

echo Building Windows sandbox helper...
cargo build --release --manifest-path native\windows-sandbox-helper\Cargo.toml
if errorlevel 1 goto :error

echo.
echo Building and packaging the GUI release...
call npm run build:release --workspace apps/gui
if errorlevel 1 goto :error

echo.
echo Copying final portable zip to \\stellae-21\sw$ ...
set "ARTIFACT_DIR=apps\gui\artifacts\electron"
set "PORTABLE_ZIP="
for /f "delims=" %%F in ('dir /b /a-d /o-d "%ARTIFACT_DIR%\*.zip" 2^>nul') do (
  if not defined PORTABLE_ZIP set "PORTABLE_ZIP=%%F"
)
if not defined PORTABLE_ZIP (
  echo No portable zip found in %ARTIFACT_DIR%.
  goto :error
)
copy /y "%ARTIFACT_DIR%\%PORTABLE_ZIP%" "\\stellae-21\sw$\%PORTABLE_ZIP%"
if errorlevel 1 goto :error

echo.
echo Done. Release artifacts are in:
echo %ARTIFACT_DIR%
echo Copied portable zip to \\stellae-21\sw$\%PORTABLE_ZIP%
exit /b 0

:error
echo.
echo Packaging failed.
exit /b 1
