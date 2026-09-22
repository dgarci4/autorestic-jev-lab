#!/usr/bin/env bash
# Unreadable source file.
source "$(dirname "$0")/_common.sh"
banner permissions "data/media/photo-1.bin with chmod 000"
chmod 000 data/media/photo-1.bin
SCENARIO=permissions ./backup.sh docs-local
rc=$?; chmod 644 data/media/photo-1.bin; exit $rc
