#!/usr/bin/env bash
# Configuration error: location does not exist.
source "$(dirname "$0")/_common.sh"
banner config_error "location 'docs-nope' does not exist in the YAML"
SCENARIO=config_error ./backup.sh docs-nope
