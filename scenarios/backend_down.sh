#!/usr/bin/env bash
# Backend unreachable: the rest-server is stopped. restic would retry for up to 15 min,
# so the wrapper uses a 15s timeout. The server comes back at 18s, so that the retry
# Jev decides on (10s after the triage) has a chance to succeed.
source "$(dirname "$0")/_common.sh"
banner backend_down "rest-server stopped; comes back on its own at 18s"
docker stop lab-rest-server >/dev/null
( sleep 18; docker start lab-rest-server >/dev/null ) &
SCENARIO=backend_down BACKUP_TIMEOUT=15 ./backup.sh docs-remote
rc=$?; wait; docker start lab-rest-server >/dev/null 2>&1; exit $rc
