#!/usr/bin/env bash
# Compute (and create) the handover folder + a non-clobbering file path for today.
# Folder pattern: {month}/{month}{day}  (lowercase month name, zero-padded day) e.g. june/june01
# Prints the absolute path to the handover file to write; never overwrites an existing one.
#
# Usage: handover_path.sh [repo-root]   (defaults to current directory)
set -euo pipefail

root="${1:-.}"
root="$(cd "$root" && pwd)"

month="$(date +%B | tr '[:upper:]' '[:lower:]')"   # e.g. june
day="$(date +%d)"                                   # zero-padded, e.g. 01
dir="$root/$month/$month$day"
mkdir -p "$dir"

# Next free session number = (count of existing handover-session-*.md) + 1
existing="$(find "$dir" -maxdepth 1 -name 'handover-session-*.md' 2>/dev/null | wc -l | tr -d ' ')"
n=$((existing + 1))

echo "$dir/handover-session-$n.md"
