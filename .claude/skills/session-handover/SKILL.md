---
name: session-handover
description: >-
  Write a structured handover document at the end of a work session so the NEXT agent resumes
  exactly where this one stopped — no lost context. Use this whenever the user signals they are
  stopping or pausing work: "end session", "wrap up", "wrap it up", "hand off", "handover", "save
  progress", "save state for next time", "we're about to /clear", "pause here", "stop for today",
  "pick this up later", or similar. Trigger it proactively when a substantial work session is
  clearly ending even if the user doesn't say the word "handover". The handover captures what was
  done, what's left, the concrete next steps, the files that matter, and the .md files the next
  agent should load into context first — and writes it to a {month}/{month}{day}/ folder in the
  repo (e.g. june/june01/). Do NOT use this for a quick mid-task note or a commit message; it is
  for ending/pausing a session with continuity.
---

# Session Handover

The point of this skill is continuity. A fresh agent starts a new session with none of this
session's working memory — it can't see what was tried, decided, half-finished, or learned. A good
handover transplants that working memory onto disk so the next session opens the handover, reads a
couple of pointed files, and is productive in minutes instead of re-deriving everything.

Write the handover **for a specific reader**: a capable agent who knows nothing about this session.
Tell that agent what happened, what's left, what to do next, and exactly what to read first.

## Where it goes

Handovers live in a dated folder at the repo root, pattern `{month}/{month}{day}/` — lowercase month
name, zero-padded day. Today that is `june/june01/`. Multiple sessions in a day get separate files
in the same folder.

Use the bundled script to compute the path and create the folder (it never overwrites an existing
handover — it picks the next free session number):

```bash
bash .claude/skills/session-handover/scripts/handover_path.sh <repo-root>
# prints e.g. /repo/june/june01/handover-session-2.md  (folder already created)
```

If the script isn't reachable, replicate it: `month=$(date +%B | tr '[:upper:]' '[:lower:]')`,
`day=$(date +%d)`, folder `<root>/$month/$month$day`, file `handover-session-<N>.md` where N is one
more than the count of existing `handover-session-*.md` in that folder.

## Workflow

### 1. Reconstruct the session — gather evidence, don't guess

Build an accurate picture of what actually happened. Pull from the conversation (decisions,
blockers, dead-ends, things the user asked for) AND from the repo so you don't misremember:

- If it's a git repo (`git rev-parse --is-inside-work-tree`): run `git status --short`,
  `git diff --stat`, and `git log --oneline -15` to see touched files and recent commits.
- If it's **not** a git repo (common): list recently modified files, e.g.
  `find <root> -type f -not -path '*/node_modules/*' -not -path '*/.git/*' -mtime -1 | head -50`,
  and lean on the conversation for the narrative.

Be honest about state. Only claim something is "done/passing/verified" if it actually ran this
session — write what you saw (e.g. "70/70 tests pass", "web build green") and note anything you
*didn't* verify. A handover that overstates progress is worse than none, because the next agent
trusts it.

### 2. Chain to the previous handover

Find the most recent prior handover so the trail is continuous:
`ls -t <root>/*/*/handover-session-*.md 2>/dev/null | head -1`. Reference it in the new handover
("continues from …") and carry forward any of its next-steps that are still open. This turns
isolated notes into a resumable thread across many sessions.

### 3. Curate the "load into context" list — this is the highest-leverage section

The next agent's first move will be to read the files you list. Choose the few that *orient* a
newcomer, in the order they should be read. Discover candidates, then pick deliberately:

```bash
find <root> -name '*.md' -not -path '*/node_modules/*' -not -path '*/.git/*' | head -50
```

Typical high-value picks (include only what exists and is relevant to the in-flight work):
- this handover itself (always first),
- project memory / agent guide (e.g. `CLAUDE.md`),
- overview (`README.md`),
- the plan / design doc driving the work (e.g. `PLAN.md`),
- package- or feature-level docs touching what's mid-flight.

For each, give a one-line reason. Don't list everything — a list of 30 files is as useless as no
list. Five well-chosen files with read-order and rationale is the goal.

### 4. Fill the template and write the file

Read `assets/handover-template.md` and fill every section concretely. Keep prose tight — the reader
wants signal. The five required sections are: **what was done**, **what remains**, **next steps
(action checklist)**, **relevant files**, and **load-into-context list**. Write the result to the
path from step 1.

### 5. Confirm and point the next session at it

Tell the user the exact path written, and one line on how the next session resumes (open that
handover first). If you maintain other continuity surfaces (a memory file, a planning doc), mention
whether they were updated too — but the dated handover is the source of truth for "where we left
off."

## What good looks like

- **Next steps are executable.** "Wire pgvector store behind EmbeddingIndex (interface already
  matches; needs a running Postgres)" beats "continue the database work."
- **Files carry a reason.** `packages/runtime/src/embedding.ts — cosine index; swap for pgvector here`
  beats a bare path.
- **State is truthful.** Distinguish "verified this session" from "believed but unverified."
- **It's skimmable.** A new agent should grasp the situation in under a minute.
