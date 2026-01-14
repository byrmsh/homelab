#!/bin/sh
curl -X GET "https://api.cloudflare.com/client/v4/accounts/$(pulumi config get homelab:cloudflareAccountId)/access/apps" \
  -H "Authorization: Bearer $(pulumi config get cloudflare:apiToken)" \
  -H "Content-Type: application/json"
