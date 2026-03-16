#!/bin/bash
# Inject directory tree at SessionStart so Claude knows real file paths.
# Prevents path hallucination by giving structural context upfront.

# Bail out if not inside a git repo
git rev-parse --is-inside-work-tree &>/dev/null || exit 0

# Navigate to the git working tree root (handles worktrees correctly)
PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
[ -z "$PROJECT_ROOT" ] && exit 0

# Auto-detect depth: 4 for monorepo (has apps/), 3 otherwise.
# TREE_DEPTH env var overrides.
if [ -n "$TREE_DEPTH" ]; then
  DEPTH="$TREE_DEPTH"
elif [ -d "$PROJECT_ROOT/apps" ]; then
  DEPTH=4
else
  DEPTH=3
fi

EXCLUDES="node_modules|.next|dist|.git|.beads|coverage|.turbo|.worktrees"

echo "## Project Structure"
echo ""
echo "<tree>"

if command -v tree &>/dev/null; then
  tree -L "$DEPTH" -I "$EXCLUDES" --dirsfirst "$PROJECT_ROOT" 2>/dev/null
else
  # Fallback: find-based output
  cd "$PROJECT_ROOT" || exit 0
  find . -maxdepth "$DEPTH" \
    -not -path '*/node_modules/*' \
    -not -path '*/.next/*' \
    -not -path '*/dist/*' \
    -not -path '*/.git/*' \
    -not -path '*/.beads/*' \
    -not -path '*/coverage/*' \
    -not -path '*/.turbo/*' \
    -not -path '*/.worktrees/*' \
    -not -name 'node_modules' \
    -not -name '.next' \
    -not -name 'dist' \
    -not -name '.git' \
    -not -name '.beads' \
    -not -name 'coverage' \
    -not -name '.turbo' \
    -not -name '.worktrees' \
    | sort
fi

echo "</tree>"

exit 0
