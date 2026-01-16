import * as pulumi from '@pulumi/pulumi'
import * as cloudflare from '@pulumi/cloudflare'
import * as random from '@pulumi/random'
import {
  cfAccountId,
  cfztOrgName,
  domainName,
  orgAuthDomain,
  cfZoneId,
  CONTROL_PLANE_GROUP_NAME,
  WORKER_GROUP_NAME,
  CONTROL_PLANE_NODE_COUNT,
  WORKER_NODE_COUNT,
  cfApiToken,
} from './config'
import { CfTunnelDrainer } from './tunnel-drainer'
import { enumerate, generateServerName, indentOutputText } from './utils'

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
  { dependsOn: [infraTunnel] }
)

const infraTunnelToken = pulumi
  .all([cfAccountId, infraTunnel.id])
  .apply(([accountId, tunnelId]) =>
    cloudflare.getZeroTrustTunnelCloudflaredToken({ accountId, tunnelId })
  )
  .apply(res => res.token)

export const createCloudConfig = (
  privateKey: pulumi.Input<string>,
  publicKey: pulumi.Input<string>
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

type _ConfigIngress = cloudflare.types.input.ZeroTrustTunnelCloudflaredConfigConfigIngress

const createSshIngress = (prefix: string, i: number, ipOffset: number): _ConfigIngress => {
  const name = generateServerName(prefix, i)
  const nameWithSsh = `${name}-ssh`
  const ip = `10.0.1.${ipOffset + i}`

  // Cloudflare's standard Universal SSL certificates only cover one level of subdomain,
  // so we need to use $host-ssh.domain.tld instead of $host.ssh.domain.tld or similar.
  new cloudflare.DnsRecord(`${name}-ssh-dns`, {
    zoneId: cfZoneId,
    name: nameWithSsh,
    type: 'CNAME',
    content: pulumi.interpolate`${infraTunnel.id}.cfargotunnel.com`,
    proxied: true,
    ttl: 1,
  })

  // HACK: also need to create a dedicated Zero Trust Access Application for each SSH hostname
  // unless we use the paid feature https://developers.cloudflare.com/ssl/edge-certificates/advanced-certificate-manager/
  // NOTE: current approach exposes predictable hostnames and may facilitate subdomain enumeration
  new cloudflare.ZeroTrustAccessApplication(`${name}-ssh-app`, {
    accountId: cfAccountId,
    name: `SSH Access - ${name}`,
    domain: pulumi.interpolate`${nameWithSsh}.${domainName}`,
    type: 'ssh',
    policies: [{ id: orgDomainAccessPolicy.id }],
  })

  return {
    hostname: pulumi.interpolate`${nameWithSsh}.${domainName}`,
    service: `ssh://${ip}:22`,
  }
}

const createSshIngressGroup = (groupName: string, nodeCount: number, ipOffset: number) =>
  enumerate(nodeCount).map(i => createSshIngress(groupName, i, ipOffset))

const ctrlIngresses = createSshIngressGroup(CONTROL_PLANE_GROUP_NAME, CONTROL_PLANE_NODE_COUNT, 10)
const workerIngresses = createSshIngressGroup(WORKER_GROUP_NAME, WORKER_NODE_COUNT, 20)
const tunnelIngresses = [...ctrlIngresses, ...workerIngresses, { service: 'http_status:404' }]

new cloudflare.ZeroTrustTunnelCloudflaredConfig('infra-tunnel-config', {
  accountId: cfAccountId,
  tunnelId: infraTunnel.id,
  config: { ingresses: tunnelIngresses },
})
