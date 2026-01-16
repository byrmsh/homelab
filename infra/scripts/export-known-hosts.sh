#!/bin/sh
set -eu

KNOWN_HOSTS_FILE="$HOME/.ssh/known_hosts_homelab"
mkdir -p "$HOME/.ssh"

if pulumi stack output knownHostsFile --show-secrets > "$KNOWN_HOSTS_FILE"; then
  echo "Updated $KNOWN_HOSTS_FILE"
else
  echo "Failed to write $KNOWN_HOSTS_FILE" >&2
  exit 1
fi

echo ""
echo "Add the following to your ~/.ssh/config:"
echo "Host *-ssh.$(pulumi config get domainName)"
echo "  User root"
echo "  IdentityFile ~/.ssh/id_ed25519 # or your preferred key"
echo "  ProxyCommand cloudflared access ssh --hostname %h"
echo "  StrictHostKeyChecking yes"
echo "  UserKnownHostsFile $KNOWN_HOSTS_FILE"
