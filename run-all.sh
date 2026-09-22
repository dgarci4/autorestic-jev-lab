#!/usr/bin/env bash
# Runs every scenario and summarises: expected cause vs cause diagnosed by Jev.
cd "$(dirname "$0")"
: > logs/results.jsonl
declare -A EXPECT=( [backend_down]=backend_unreachable [locked]=locked [wrong_password]=auth
  [disk_full]=disk_full [permissions]=permissions [repo_corrupt]=repo_corrupt [config_error]=config_error )
for s in backend_down locked wrong_password disk_full permissions repo_corrupt config_error; do
  ./scenarios/$s.sh
done
echo; echo "=================== SUMMARY ==================="
printf '%-15s %-20s %-20s %-6s %-5s %-8s %-17s %-13s %s\n' scenario expected jev prob urg trans action outcome ms
jq -r --argjson e "$(for k in "${!EXPECT[@]}"; do printf '"%s":"%s",' "$k" "${EXPECT[$k]}"; done | sed 's/,$//; s/^/{/; s/$/}/')" '
  . as $r | ($e[$r.scenario]) as $exp |
  [ $r.scenario, $exp, ($r.cause // "-"),
    (if $r.cause_probabilities then ($r.cause_probabilities[$r.cause] | tostring) else "-" end),
    (($r.urgency // 0) | tostring), (($r.transient // 0) | tostring), ($r.action // "-"), $r.outcome,
    (($r.jev_ms // 0) | tostring),
    (if $exp == $r.cause then "OK" else "MISS" end) ] | @tsv' logs/results.jsonl |
  awk -F'\t' '{printf "%-15s %-20s %-20s %-6s %-5s %-8s %-17s %-13s %-5s %s\n",$1,$2,$3,$4,$5,$6,$7,$8,$9,$10}'
