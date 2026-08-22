#!/usr/bin/env bash
# Installs the memory post-commit hook.
#
#   ./install-hook.sh            # this repo
#   ./install-hook.sh --global   # every repo, via core.hooksPath
#
# Global mode sets core.hooksPath to ~/.claude/git-hooks. If you already use a
# hooks manager (husky, lefthook, pre-commit), do NOT use --global — it would
# take over hook dispatch for every repo. Install per-repo instead, or add a
# call to this script from your existing post-commit.
set -euo pipefail

src="$(cd "$(dirname "$0")" && pwd)/post-commit"
[ -f "$src" ] || { echo "post-commit not found next to this script" >&2; exit 1; }

if [ "${1:-}" = "--global" ]; then
  dir="$HOME/.claude/git-hooks"
  existing="$(git config --global core.hooksPath || true)"
  if [ -n "$existing" ] && [ "$existing" != "$dir" ]; then
    echo "core.hooksPath is already set to: $existing" >&2
    echo "Refusing to overwrite it. Install per-repo instead, or chain manually." >&2
    exit 1
  fi
  mkdir -p "$dir"
  cp "$src" "$dir/post-commit"
  chmod +x "$dir/post-commit"
  git config --global core.hooksPath "$dir"
  echo "installed globally: $dir/post-commit"
  echo "note: this repo's .git/hooks/* are now ignored by git in ALL repos."
  exit 0
fi

repo="$(git rev-parse --show-toplevel 2>/dev/null)" || { echo "not a git repo" >&2; exit 1; }
hooks="$repo/$(git rev-parse --git-dir)/hooks"
mkdir -p "$hooks"

if [ -e "$hooks/post-commit" ] && ! grep -q 'ingest/commit' "$hooks/post-commit" 2>/dev/null; then
  echo "A post-commit hook already exists at $hooks/post-commit" >&2
  echo "Chain it manually rather than overwriting:" >&2
  echo "  echo '\"$src\"' >> $hooks/post-commit" >&2
  exit 1
fi

cp "$src" "$hooks/post-commit"
chmod +x "$hooks/post-commit"
echo "installed: $hooks/post-commit"
