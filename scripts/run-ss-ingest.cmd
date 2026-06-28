@echo off
rem HYTEK Fab — SS-ingest bridge wrapper (run on the always-on office server).
rem Reads its secrets from ss-ingest-bridge.env.cmd beside this file (NOT committed),
rem then runs the bridge and appends to a log. Schedule via Task Scheduler.
rem See docs/ss-ingest-bridge-runbook.md.
cd /d "%~dp0\.."
if not exist "%~dp0ss-ingest-bridge.env.cmd" (
  echo Missing scripts\ss-ingest-bridge.env.cmd ^(see docs/ss-ingest-bridge-runbook.md^)
  exit /b 1
)
call "%~dp0ss-ingest-bridge.env.cmd"
node scripts\ss-ingest-bridge.mjs >> "%~dp0ss-ingest-bridge.log" 2>&1
