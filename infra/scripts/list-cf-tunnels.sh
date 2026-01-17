#!/bin/sh
set -eu

ACCOUNT_ID=$(pulumi config get cloudflareAccountId)
API_TOKEN=$(pulumi config get cloudflare:apiToken)

if [ -z "$ACCOUNT_ID" ] || [ -z "$API_TOKEN" ]; then
  echo "Error: Missing Cloudflare account ID or API token" >&2
  exit 1
fi

URL="https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/cfd_tunnel"

curl -s -X GET "$URL" \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" | jq