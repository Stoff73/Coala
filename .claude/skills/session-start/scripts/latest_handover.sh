#!/usr/bin/env bash
# Find the most recent session handover written by the session-handover skill.
# Searches {month}/{month}{day}/handover-session-*.md folders and returns the newest by mtime.
# Prints the absolute path, or "NONE" if there is no handover yet.
#
# Usage: latest_handover.sh [repo-root]   (defaults to current directory)
set -euo pipefail

root="${1:-.}"
root="$(cd "$root" && pwd)"

latest="$(find "$root" -type f -name 'handover-session-*.md' \
  -not -path '*/node_modules/*' -not -path '*/.git/*' \
  -exec ls -t {} + 2>/dev/null | head -1 || true)"

if [ -z "$latest" ]; then
  echo "NONE"
else
  echo "$latest"
fi
