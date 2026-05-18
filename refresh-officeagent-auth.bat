@echo off
setlocal

set "SERVER=172.16.1.124"
set "USER=dario"
set "LOCAL_AUTH=%USERPROFILE%\.pi\agent\auth.json"
set "REMOTE_AUTH=/home/dario/officeagent-auth.json"

echo == OfficeAgent gateway auth refresh ==
echo Server: %USER%@%SERVER%
echo Local auth: %LOCAL_AUTH%
echo.

if not exist "%LOCAL_AUTH%" (
  echo ERROR: local auth file not found: %LOCAL_AUTH%
  exit /b 1
)

echo == Uploading local Pi auth to server ==
scp "%LOCAL_AUTH%" %USER%@%SERVER%:%REMOTE_AUTH%
if errorlevel 1 (
  echo ERROR: scp upload failed.
  exit /b %errorlevel%
)

echo.
echo == Installing auth on server, restarting gateway, and probing auth ==
ssh -t %USER%@%SERVER% "sudo bash -lc 'set -e; install -o officeagent -g officeagent -m 600 /home/dario/officeagent-auth.json /var/lib/office-agent/gateway-auth/auth.json; rm -f /home/dario/officeagent-auth.json; systemctl restart office-agent-gateway; cd /opt/office-agent; set -a; . /etc/office-agent/gateway.env; set +a; npm run gateway:probe-auth; echo; echo == health ==; curl -sS http://127.0.0.1:8082/health; echo'"
if errorlevel 1 (
  echo ERROR: remote install/probe failed.
  exit /b %errorlevel%
)

echo.
echo == Done ==
pause
