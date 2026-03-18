#!/usr/bin/env bash
set -euo pipefail

# Register the package on npm with a placeholder version.
# Run this once before the first semantic-release to claim the package name.

PACKAGE_NAME=$(node -p "require('./package.json').name")

echo "Registering ${PACKAGE_NAME} on npm..."
npm publish --access public --dry-run

echo ""
echo "If the dry-run looks good, publish the initial placeholder:"
echo "  npm publish --access public"
