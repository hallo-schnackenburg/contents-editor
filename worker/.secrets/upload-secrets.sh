#!/bin/bash
# Usage, from worker/: bash .secrets/upload-secrets.sh staging|production
# Puts the secrets of .secrets/<env> into the deployed Worker of that environment.

env=$1
for key in ANTHROPIC_API_KEY GITHUB_CLIENT_SECRET SESSION_SECRET WEBHOOK_SECRET; do
  grep "^$key=" ".secrets/$env" | cut -d= -f2- | tr -d '\n\r ' | npx wrangler secret put "$key" --env "$env"
done
