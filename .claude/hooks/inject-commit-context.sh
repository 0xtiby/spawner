#!/bin/bash
# Inject last 10 commit messages as progress context

if git rev-parse --is-inside-work-tree &>/dev/null; then
  echo "## Recent Commits"
  echo ""
  git log -10 --format="### %h - %s%n%n%b" 2>/dev/null || echo "(no commits yet)"
fi

exit 0
