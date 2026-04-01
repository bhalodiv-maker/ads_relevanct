#!/usr/bin/env bash
# Run this in YOUR Mac terminal (not a headless agent) so GitHub can use Keychain / browser login.
set -euo pipefail
USAGE="Usage: $0 <repository-URL>

Examples:
  $0 https://github.com/YOUR_USERNAME/store-query-relevance.git
  $0 git@github.com:YOUR_USERNAME/store-query-relevance.git

Create an empty repo on GitHub first (no README) if you have not already."
URL="${1:-}"
if [[ -z "$URL" ]]; then echo "$USAGE" >&2; exit 1; fi
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
if git remote get-url origin >/dev/null 2>&1; then
  git remote set-url origin "$URL"
  echo "Updated origin -> $URL"
else
  git remote add origin "$URL"
  echo "Added origin -> $URL"
fi
git push -u origin main
echo ""
echo "Next: GitHub repo → Settings → Pages → Deploy from branch main, folder / (root)."
echo "Share: https://YOUR_USERNAME.github.io/YOUR_REPO/  (opens dashboard via index.html)"
