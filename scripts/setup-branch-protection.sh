#!/usr/bin/env bash
set -euo pipefail

# Set up branch protection rules for the main branch via GitHub CLI.

REPO=$(gh repo view --json nameWithOwner -q '.nameWithOwner')

echo "Setting up branch protection for ${REPO}#main..."

gh api \
  --method PUT \
  "/repos/${REPO}/branches/main/protection" \
  --input - <<'EOF'
{
  "required_status_checks": {
    "strict": true,
    "contexts": []
  },
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "required_approving_review_count": 1
  },
  "restrictions": null
}
EOF

echo "Branch protection configured for main."
