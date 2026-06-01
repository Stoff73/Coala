---
name: session-start
description: >-
  Resume a project exactly where the last session stopped by loading the most recent handover into
  context. Use this at the START of a working session or whenever the user signals they want to pick
  up prior work: "start session", "begin", "get set up", "resume", "continue where we left off",
  "where were we", "what were we doing", "catch up", "load the handover", "pick this back up", or
  similar — and trigger it proactively at the start of a fresh session on a repo that has handover
  files. It finds the newest {month}/{month}{day}/handover-session-*.md, reads it, loads the .md
  files that handover says to load, and gives a tight orientation (where we left off + the next
  steps) so work continues immediately. This is the partner of the session-handover skill: handover
  writes the state, session-start reads it. Do NOT use it to start a brand-new project with no
  history, or as a generic "read this file" request.
---

# Session Start

A new session begins with empty working memory. If the previous session left a handover (written by
the **session-handover** skill into `{month}/{month}{day}/handover-session-*.md`), that file plus the
small set of docs it points to are everything needed to be productive again. This skill loads them
and orients you, so you continue instead of re-deriving the situation.

## Workflow

### 1. Find the latest handover

```bash
bash .claude/skills/session-start/scripts/latest_handover.sh <repo-root>
# prints the newest handover path, or "NONE"
```

If it prints `NONE`, there's no prior handover — tell the user this looks like a fresh start and ask
what they'd like to do (don't fabricate prior state). Otherwise continue.

### 2. Read the handover, then load what it tells you to

Read the handover in full. It has a **"Load these into context first"** section listing, in order,
the `.md` and source files that orient a newcomer. **Read those files now**, in that order — that's
the whole point: the previous session already did the work of selecting what matters, so trust the
list rather than re-scanning the repo. (If the handover is malformed or missing that section, fall
back to the obvious orienting files: `CLAUDE.md`, `README.md`, any plan/design doc.)

### 3. Orient the user — briefly

Give a tight summary so the user (and you) are aligned before doing anything:
- **Where we left off** — 2–4 lines from the handover's "what was done" + verification state.
- **Open next steps** — surface the handover's next-steps checklist (these are the candidate actions).
- **Anything stale to re-check** — if the handover marked state as "believed but unverified", or noted
  env caveats (e.g. a Node version, a build order), call that out so it isn't assumed.

Then stop and let the user steer — unless they already said "continue" and the top next-step is
unambiguous, in which case you may begin it. Don't silently start large changes off the handover
alone; the handover is a map, not a mandate.

## What good looks like

- You **actually read** the files in the load list, not just the handover — the handover is a pointer,
  the value is in the docs it points to.
- The orientation is **short and accurate**, and flags anything the handover said was unverified
  rather than presenting it as fact.
- You **don't re-explore** the whole repo when the handover already curated the entry points — that
  wastes the continuity the handover exists to provide.
