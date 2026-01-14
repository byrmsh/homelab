import * as pulumi from '@pulumi/pulumi'
import { infraTunnelToken } from './tunnel'

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
export const enumerate = (count: number) =>
  Array.from({ length: count }, (_, i) => i)

export const generateServerName = (group: string, i: number) =>
  `${group}-` + i.toString().padStart(2, '0')
