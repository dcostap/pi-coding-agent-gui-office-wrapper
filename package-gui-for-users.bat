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
echo Done. Release artifacts are in:
echo apps\gui\artifacts\electron
exit /b 0

:error
echo.
echo Packaging failed.
exit /b 1
