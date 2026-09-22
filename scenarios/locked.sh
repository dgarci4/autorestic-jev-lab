#!/usr/bin/env bash
# Locked repo: a container with a different hostname runs `restic check`, which takes an
# exclusive lock; as soon as the lock appears the container is paused, so the lock is held
# indefinitely. restic only clears "stale" locks from the same host (or older than 30 min),
# so this one really blocks.
source "$(dirname "$0")/_common.sh"
banner locked "foreign exclusive lock on repos/local"
docker rm -f lab-locker >/dev/null 2>&1
# Start from a clean slate: a leftover lock from an earlier run would be mistaken for the new one.
# restic ignores half-written "*-tmp-*" files in locks/, so only 64-hex names count as locks.
autorestic exec -b local --ci -- unlock --remove-all >/dev/null 2>&1
rm -f repos/local/locks/*-tmp-* 2>/dev/null
lock_count() { ls repos/local/locks 2>/dev/null | grep -cE '^[0-9a-f]{64}$'; }
# --user: restic writes repo files with mode 0600; a lock created by root is unreadable
#         from the host and the error becomes "permission denied" instead of "locked".
# --cpus 0.05: unthrottled, a check of 15 MB finishes in a fraction of a second and releases the lock.
docker run -d --name lab-locker --hostname other-host --cpus 0.05 --user "$(id -u):$(id -g)" \
  -v "$LAB/repos/local:/repo" -e RESTIC_PASSWORD="$(key_of local)" -e RESTIC_CACHE_DIR=/tmp/cache \
  restic/restic:latest -r /repo check --read-data >/dev/null
for i in $(seq 1 600); do [ "$(lock_count)" -gt 0 ] && break; sleep 0.2; done
docker pause lab-locker >/dev/null
echo "locks present: $(lock_count) (after $((i/5))s); container paused while holding the lock"
SCENARIO=locked ./backup.sh docs-local
rc=$?; docker rm -f lab-locker >/dev/null; exit $rc
