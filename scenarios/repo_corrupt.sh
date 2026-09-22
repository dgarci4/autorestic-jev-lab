#!/usr/bin/env bash
# Damaged repository: the repo's config file goes missing.
source "$(dirname "$0")/_common.sh"
banner repo_corrupt "repos/local/config removed"
mv repos/local/config logs/config.bak
SCENARIO=repo_corrupt ./backup.sh docs-local
rc=$?; mv logs/config.bak repos/local/config; exit $rc
