#!/usr/bin/env bash
# Backup wrapper with automatic triage.
# usage: ./backup.sh <location>
# If autorestic fails, its output goes to Jev, which returns cause/urgency/action,
# and the action is executed here (unlock and retry, retry later, or alert).
set -u
cd "$(dirname "$0")"
export PATH="$PWD/bin:$PATH"
# .env holds AI_GATEWAY_API_KEY (and optional settings); .autorestic.env is read by autorestic itself
if [ -f .env ]; then set -a; . ./.env; set +a; fi
LOC=${1:?location}
SCENARIO=${SCENARIO:-manual}
TS=$(date +%Y%m%d-%H%M%S)
LOG="logs/$LOC-$TS.log"

# restic retries on its own against a dead backend for up to 15 min;
# an external timeout is what turns that into a diagnosable failure.
BACKUP_TIMEOUT=${BACKUP_TIMEOUT:-120}
TIMEOUT_BIN=$(command -v timeout || command -v gtimeout || true)   # gtimeout: coreutils on macOS
[ -z "$TIMEOUT_BIN" ] && echo "warning: no 'timeout' command found, running without a timeout" >&2
run_backup() { $TIMEOUT_BIN ${TIMEOUT_BIN:+$BACKUP_TIMEOUT} autorestic backup -l "$LOC" --ci > "$LOG" 2>&1; }

# Backend of the location (exec does not accept -l, only -b backend).
# The YAML is simple enough for awk: "  <location>:" followed by "    to: <backend>".
backends_of() {
  awk -v loc="$LOC:" '$1==loc {f=1; next} f && $1=="to:" {print $2; exit} f && /^  [a-z]/ {f=0}' .autorestic.yml
}

record() { # $1=decision json, $2=outcome
  jq -c --arg s "$SCENARIO" --arg o "$2" --arg log "$LOG" '. + {scenario:$s, outcome:$o, log:$log}' <<<"$1" >> logs/results.jsonl
}

alert() { # $1=level $2=decision
  echo "$(date -Is) [$1] $(jq -c '{location,cause,urgency,transient,needs_human}' <<<"$2")" >> logs/alerts.log
  echo ">>> ALERT [$1]: cause=$(jq -r .cause <<<"$2") urgency=$(jq -r .urgency <<<"$2") (see $LOG)"
}

run_backup; rc=$?
if [ $rc -eq 0 ]; then
  echo "OK: backup of '$LOC' succeeded"
  [ "$SCENARIO" != manual ] && record '{"location":"'"$LOC"'","cause":null,"action":"none"}' "success"
  exit 0
fi
[ $rc -eq 124 ] && echo "(${BACKUP_TIMEOUT}s timeout exceeded)"
echo "FAILED rc=$rc on '$LOC'. Last errors:"
grep -iE 'fatal|error|warn' "$LOG" | tail -3 | sed 's/^/    /'
echo "--- Jev triage ---"
DECISION=$(node jev/triage.mjs --location "$LOC" --exit "$rc" --log "$LOG") || { echo "triage failed"; exit 2; }
jq '{cause, cause_probabilities, transient, needs_human, urgency, action, jev_ms, cost_usd}' <<<"$DECISION"
ACTION=$(jq -r .action <<<"$DECISION")

case "$ACTION" in
  unlock_and_retry)
    echo "--- action: unlock --remove-all and retry ---"
    for b in $(backends_of); do autorestic exec -b "$b" --ci -- unlock --remove-all >> "logs/$LOC-$TS-unlock.log" 2>&1; done
    if run_backup; then echo "RECOVERED after unlock"; record "$DECISION" "recovered"; exit 0; fi
    echo "still failing after unlock"; alert high "$DECISION"; record "$DECISION" "retry_failed"; exit 1 ;;
  retry_later)
    echo "--- action: wait 10s and retry ---"
    sleep 10
    if run_backup; then echo "RECOVERED on retry"; record "$DECISION" "recovered"; exit 0; fi
    echo "still failing after retry"; alert high "$DECISION"; record "$DECISION" "retry_failed"; exit 1 ;;
  alert_critical)
    alert critical "$DECISION"; record "$DECISION" "alerted"; exit 1 ;;
  *)
    alert medium "$DECISION"; record "$DECISION" "alerted"; exit 1 ;;
esac
