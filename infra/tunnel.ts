import * as pulumi from '@pulumi/pulumi'
import * as cloudflare from '@pulumi/cloudflare'
import * as random from '@pulumi/random'
import * as fs from 'fs'
import * as path from 'path'
import { cfAccountId, cfztOrgName, domainName, orgAuthDomain, cfZoneId, cfApiToken } from './config'
import { CfTunnelDrainer } from './tunnel-drainer'
import { fillTemplate } from './utils'

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
const tunnelDrainer = new CfTunnelDrainer(
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

const toBase64 = (value: pulumi.Input<string>) =>
  pulumi.output(value).apply(v => Buffer.from(v).toString('base64'))

const cloudConfigTemplate = fs.readFileSync(
  path.join(__dirname, 'templates', 'cloud-config.yaml'),
  'utf8',
)

export const createCloudConfig = (
  privateKey: pulumi.Input<string>,
  publicKey: pulumi.Input<string>,
  hostCert: pulumi.Input<string>,
) =>
  pulumi
    .all({
      privateKeyB64: toBase64(privateKey),
      publicKeyB64: toBase64(publicKey),
      hostCertB64: toBase64(hostCert),
      infraTunnelToken,
    })
    .apply(values =>
      fillTemplate(cloudConfigTemplate, {
        SSH_HOST_KEY_B64: values.privateKeyB64,
        SSH_HOST_PUB_B64: values.publicKeyB64,
        SSH_HOST_CERT_B64: values.hostCertB64,
        INFRA_TUNNEL_TOKEN: values.infraTunnelToken,
      }),
    )

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
