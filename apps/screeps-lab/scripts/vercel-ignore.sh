#!/usr/bin/env sh
set -eu

if [ "${VERCEL_GIT_COMMIT_REF:-}" = "main" ]; then
  exit 1
fi

if git log -1 --pretty=%B | grep -q '\[vercel-preview\]'; then
  exit 1
fi

exit 0
