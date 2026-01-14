import * as pulumi from '@pulumi/pulumi'
import * as cloudflare from '@pulumi/cloudflare'
import * as random from '@pulumi/random'
import {
  adminEmail,
  cfAccountId,
  cfztOrgName,
  domainName,
  orgAuthDomain,
} from './config'

export const tunnelSecret = new random.RandomPassword('tunnel-secret', {
  length: 64,
  special: false,
}).result

export const infraTunnel = new cloudflare.ZeroTrustTunnelCloudflared(
  'infra-tunnel',
  {
    accountId: cfAccountId,
    name: 'infra-tunnel',
    tunnelSecret,
  },
)

export const tunnelRoute = new cloudflare.ZeroTrustTunnelCloudflaredRoute(
  'infra-tunnel-route',
  {
    accountId: cfAccountId,
    tunnelId: infraTunnel.id,
    network: '10.0.0.0/16',
    comment: 'Route to K3s Private Network via Hetzner',
  },
)

export const infraTunnelToken = pulumi
  .all([cfAccountId, infraTunnel.id])
  .apply(([accountId, tunnelId]) =>
    cloudflare.getZeroTrustTunnelCloudflaredToken({ accountId, tunnelId }),
  )

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
  },
)

export const appLauncher = new cloudflare.ZeroTrustAccessApplication(
  'app-launcher',
  {
    accountId: cfAccountId,
    domain: orgAuthDomain,
    name: 'App Launcher',
    sessionDuration: '24h',
    type: 'app_launcher',
    policies: [{ id: orgDomainAccessPolicy.id }],
  },
  { protect: true }, // imported
)

export const warpEnrollmentApp = new cloudflare.ZeroTrustAccessApplication(
  'warp-enrollment-app',
  {
    accountId: cfAccountId,
    domain: orgAuthDomain,
    name: 'WARP Enrollment',
    type: 'warp',
    sessionDuration: '24h',
    policies: [{ id: orgDomainAccessPolicy.id }],
    autoRedirectToIdentity: true,
  },
)

export const adminWarpCustomProfile =
  new cloudflare.ZeroTrustDeviceCustomProfile('admin-warp-custom-profile', {
    accountId: cfAccountId,
    name: 'Allow Admin Warp Access',
    description: 'Allows the admin to connect to the Hetzner Private Network',
    enabled: true,
    precedence: 10,
    match: pulumi.interpolate`identity.email == "${adminEmail}"`,
    serviceModeV2: { mode: 'warp' },
    includes: [
      { address: '10.0.0.0/16', description: 'Hetzner Private Network' },
    ],
    switchLocked: false,
    allowModeSwitch: true,
  })
