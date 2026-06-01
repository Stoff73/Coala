#!/usr/bin/env bash
# SessionStart hook: surface the most recent handover so the agent resumes cleanly.
# Prints a short reminder (added to session context) when a handover exists; silent otherwise.
set -euo pipefail

# Resolve repo root: prefer $CLAUDE_PROJECT_DIR (set by Claude Code), else this script's repo.
root="${CLAUDE_PROJECT_DIR:-}"
if [ -z "$root" ]; then
  here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  root="$(cd "$here/../../../.." && pwd)"   # .claude/skills/session-start/scripts -> repo root
fi

latest="$(find "$root" -type f -name 'handover-session-*.md' \
  -not -path '*/node_modules/*' -not -path '*/.git/*' \
  -exec ls -t {} + 2>/dev/null | head -1 || true)"

if [ -n "$latest" ]; then
  rel="${latest#"$root"/}"
  echo "📋 Session continuity: a handover from the last session exists at \`$rel\`."
  echo "Use the **session-start** skill — read that handover and the .md files it lists, then orient before working."
fi
