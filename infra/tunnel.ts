import * as pulumi from '@pulumi/pulumi'
import * as cloudflare from '@pulumi/cloudflare'
import * as random from '@pulumi/random'
import { cfAccountId, cfztOrgName, domainName, orgAuthDomain, cfZoneId, cfApiToken } from './config'
import { CfTunnelDrainer } from './tunnel-drainer'
import { indentOutputText } from './utils'

const tunnelSecret = new random.RandomPassword('tunnel-secret', {
  length: 64,
  special: false,
}).result

export const infraTunnel = new cloudflare.ZeroTrustTunnelCloudflared('infra-tunnel', {
  accountId: cfAccountId,
  name: 'infra-tunnel',
  tunnelSecret,
})

// Prevent runtime error about deleting a tunnel still in use
export const tunnelDrainer = new CfTunnelDrainer(
  'infra-tunnel-drainer',
  { accountId: cfAccountId, tunnelId: infraTunnel.id, apiToken: cfApiToken },
  { dependsOn: [infraTunnel] },
)

const infraTunnelToken = pulumi
  .all([cfAccountId, infraTunnel.id])
  .apply(([accountId, tunnelId]) =>
    cloudflare.getZeroTrustTunnelCloudflaredToken({ accountId, tunnelId }),
  )
  .apply(res => res.token)

export const createCloudConfig = (
  privateKey: pulumi.Input<string>,
  publicKey: pulumi.Input<string>,
) => pulumi.interpolate`#cloud-config
package_update: false
package_upgrade: false
packages:
  - curl
  - python3

ssh_keys:
  ed25519_public: ${publicKey}
  ed25519_private: |
    ${indentOutputText(privateKey, 4)}

runcmd:
  # 1. Download Cloudflared (ARM64 specific)
  - curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64.deb
  - dpkg -i cloudflared.deb
  # 2. Install System Service with Token
  - cloudflared service install "${infraTunnelToken}"
  - systemctl enable --now cloudflared
  # 3. Clean up
  - rm cloudflared.deb
  - echo "Cloudflared Interface Ready"
  # 4. Restart SSH to pick up new keys
  - systemctl restart ssh
`

const team = new cloudflare.ZeroTrustOrganization('main-team', {
  accountId: cfAccountId,
  name: cfztOrgName,
  authDomain: orgAuthDomain,
  autoRedirectToIdentity: true,
})

const orgDomainAccessPolicy = new cloudflare.ZeroTrustAccessPolicy('org-domain-access-policy', {
  accountId: cfAccountId,
  name: 'Allow Only Org Domain',
  decision: 'allow',
  includes: [{ emailDomain: { domain: domainName } }],
})

const appLauncher = new cloudflare.ZeroTrustAccessApplication('app-launcher', {
  accountId: cfAccountId,
  domain: orgAuthDomain,
  name: 'App Launcher',
  sessionDuration: '24h',
  type: 'app_launcher',
  policies: [{ id: orgDomainAccessPolicy.id }],
})

const bastionHostname = pulumi.interpolate`ssh.${domainName}`

new cloudflare.DnsRecord('bastion-ssh-dns', {
  zoneId: cfZoneId,
  name: 'ssh',
  type: 'CNAME',
  content: pulumi.interpolate`${infraTunnel.id}.cfargotunnel.com`,
  proxied: true,
  ttl: 1,
})

new cloudflare.ZeroTrustAccessApplication('bastion-ssh-app', {
  accountId: cfAccountId,
  name: 'SSH Bastion Access',
  domain: bastionHostname,
  type: 'ssh',
  policies: [{ id: orgDomainAccessPolicy.id }],
})

const tunnelIngresses: cloudflare.types.input.ZeroTrustTunnelCloudflaredConfigConfigIngress[] = [
  {
    hostname: bastionHostname,
    service: 'ssh://localhost:22',
  },
  { service: 'http_status:404' },
]

new cloudflare.ZeroTrustTunnelCloudflaredConfig('infra-tunnel-config', {
  accountId: cfAccountId,
  tunnelId: infraTunnel.id,
  config: { ingresses: tunnelIngresses },
})
