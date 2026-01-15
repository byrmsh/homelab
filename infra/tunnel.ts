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
import { enumerate, generateServerName } from './utils'

export const tunnelSecret = new random.RandomPassword('tunnel-secret', {
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
  'my-tunnel-drainer',
  { accountId: cfAccountId, tunnelId: infraTunnel.id, apiToken: cfApiToken },
  { dependsOn: [infraTunnel] }
)

export const infraTunnelToken = pulumi
  .all([cfAccountId, infraTunnel.id])
  .apply(([accountId, tunnelId]) =>
    cloudflare.getZeroTrustTunnelCloudflaredToken({ accountId, tunnelId })
  )

export const CF_TUNNEL_CLOUD_CONFIG = pulumi.interpolate`#cloud-config
package_update: false
package_upgrade: false
packages:
  - curl
  - python3
runcmd:
  # 1. Download Cloudflared (ARM64 specific)
  - curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64.deb
  - dpkg -i cloudflared.deb
  # 2. Install System Service with Token
  - cloudflared service install ${infraTunnelToken.token}
  # 3. Clean up
  - rm cloudflared.deb
  - echo "Cloudflared Interface Ready"
`

export const team = new cloudflare.ZeroTrustOrganization('main-team', {
  accountId: cfAccountId,
  name: cfztOrgName,
  authDomain: orgAuthDomain,
  autoRedirectToIdentity: true,
})

export const orgDomainAccessPolicy = new cloudflare.ZeroTrustAccessPolicy(
  'org-domain-access-policy',
  {
    accountId: cfAccountId,
    name: 'Allow Only Org Domain',
    decision: 'allow',
    includes: [{ emailDomain: { domain: domainName } }],
  }
)

export const appLauncher = new cloudflare.ZeroTrustAccessApplication('app-launcher', {
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

  new cloudflare.DnsRecord(`${name}-ssh-dns`, {
    zoneId: cfZoneId,
    name: nameWithSsh,
    type: 'CNAME',
    content: pulumi.interpolate`${infraTunnel.id}.cfargotunnel.com`,
    proxied: true,
    ttl: 1,
  })

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
