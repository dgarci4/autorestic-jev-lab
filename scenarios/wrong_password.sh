#!/usr/bin/env bash
# Wrong repository key (equivalent to broken credentials). Environment variables take
# precedence over .autorestic.env, so the key is overridden just for this run.
source "$(dirname "$0")/_common.sh"
banner wrong_password "wrong key for the remote backend"
AUTORESTIC_REMOTE_RESTIC_PASSWORD=wrong-password SCENARIO=wrong_password ./backup.sh docs-remote
