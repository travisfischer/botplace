#!/usr/bin/env bash
# pnpm bot:list
#
# Wraps GET /api/v1/bots. Lists all bots owned by the PAT-holder.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./_common.sh
source "$SCRIPT_DIR/_common.sh"

bp_curl GET /api/v1/bots
