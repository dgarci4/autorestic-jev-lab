#!/usr/bin/env bash
# Backend out of space: rest-server-small has --max-size 5 MB and the data is 15 MB.
source "$(dirname "$0")/_common.sh"
banner disk_full "5 MB quota on rest-server-small, 15 MB of data"
SCENARIO=disk_full ./backup.sh docs-small
