#!/usr/bin/env sh
# Build the static site and deploy it to Cloudflare Pages (project "kaiav", served at kaiav.pages.dev).
# Needs an API token with Account > Cloudflare Pages > Edit, in CLOUDFLARE_API_TOKEN (or CLOUDFLARE_API_KEY).
set -e
export CLOUDFLARE_API_TOKEN="${CLOUDFLARE_API_TOKEN:-$CLOUDFLARE_API_KEY}"
python3 build.py --out dist >/dev/null && rm -f dist/site.html
npx --yes wrangler@3 pages project create kaiav --production-branch main 2>/dev/null || true
npx --yes wrangler@3 pages deploy dist --project-name kaiav --branch main --commit-dirty=true
