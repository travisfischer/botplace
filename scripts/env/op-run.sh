#!/usr/bin/env bash
# scripts/env/op-run.sh
#
# Run any command with 1Password-sourced secrets in process env. Reads
# `op.env` at the repo root (the env-template of `op://` references) and
# hands every variable to the inner command via `op run --env-file=`.
#
# Use this for the local-streaming dev setup. Cloud-agent setups don't
# need this wrapper — their platform injects process env directly.
#
# Usage:
#   ./scripts/env/op-run.sh <cmd> [args...]
#   pnpm op <cmd> [args...]            # equivalent (package.json shortcut)
#
# Examples:
#   pnpm op pnpm db:bootstrap
#   pnpm op pnpm dev
#   pnpm op pnpm admin:revoke-key <key-id>
#
# See docs/dev/setup.md § Running commands with secrets for the full matrix.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_TEMPLATE="$ROOT/op.env"

if [ ! -f "$ENV_TEMPLATE" ]; then
  printf 'ERROR: %s missing. This file is committed; restore from git or reclone.\n' "$ENV_TEMPLATE" >&2
  exit 2
fi

if ! command -v op >/dev/null 2>&1; then
  printf 'ERROR: 1Password CLI `op` not found on PATH. brew install 1password-cli.\n' >&2
  exit 2
fi

if ! op whoami >/dev/null 2>&1; then
  printf 'ERROR: not signed in to 1Password. Run: ! eval $(op signin)\n' >&2
  exit 2
fi

if [ "$#" -eq 0 ]; then
  printf 'usage: %s <cmd> [args...]\n' "$(basename "$0")" >&2
  exit 2
fi

exec op run --env-file="$ENV_TEMPLATE" -- "$@"
