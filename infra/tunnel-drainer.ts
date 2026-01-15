import * as pulumi from '@pulumi/pulumi'

type CfString = string | pulumi.Output<string>

interface CfTunnelDrainerInputs {
  accountId: CfString
  tunnelId: CfString
  apiToken: CfString
}

// The status of the tunnel. Valid values are:
// - inactive (tunnel has never been run),
// - degraded (tunnel is active and able to serve traffic but in an unhealthy state),
// - healthy (tunnel is active and able to serve traffic), or
// - down (tunnel can not serve traffic as it has no connections to the Cloudflare Edge).
// SOURCE: https://developers.cloudflare.com/api/resources/zero_trust/subresources/tunnels/subresources/cloudflared/methods/list/
const PossibleCfTunnelStatuses = ['inactive', 'degraded', 'healthy', 'down'] as const
type CfTunnelStatus = (typeof PossibleCfTunnelStatuses)[number]

const checkStatus = async (accountId: string, tunnelId: string, apiToken: string) => {
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/cfd_tunnel/${tunnelId}`
  const headers = { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' }
  const response = await fetch(url, { method: 'GET', headers })
  if (!response.ok) throw new Error(`API Error ${response.status}: ${response.statusText}`)
  const data = await response.json()
  const status = data.result?.status
  if (!status) throw new Error('Unexpected API response structure')
  if (PossibleCfTunnelStatuses.includes(status)) return status as CfTunnelStatus
  throw new Error('Unexpected API response value for tunnel status')
}

const checkStatusUntilDrained = async (accountId: string, tunnelId: string, apiToken: string) => {
  const status = await checkStatus(accountId, tunnelId, apiToken)
  if (status === 'inactive' || status === 'down') {
    console.log(`Tunnel status is '${status}'. Proceeding with destruction.`)
    return
  }
  console.log(`Tunnel status is '${status}'. Waiting 2s...`)
  await new Promise(r => setTimeout(r, 2000))
  return checkStatusUntilDrained(accountId, tunnelId, apiToken)
}

const cfTunnelDrainerProvider: pulumi.dynamic.ResourceProvider = {
  create(inputs: CfTunnelDrainerInputs) {
    return Promise.resolve({ id: 'drainer-' + inputs.tunnelId, outs: inputs })
  },

  delete: (_id: string, props: CfTunnelDrainerInputs) =>
    new Promise<void>((res, rej) => {
      const { accountId, tunnelId, apiToken } = props
      pulumi.all([accountId, tunnelId, apiToken]).apply(([accountId, tunnelId, apiToken]) => {
        console.log('Starting drain for tunnel')
        checkStatusUntilDrained(accountId, tunnelId, apiToken)
          .then(() => res())
          .catch(err => rej(err))
      })
    }),
}

export class CfTunnelDrainer extends pulumi.dynamic.Resource {
  constructor(name: string, args: CfTunnelDrainerInputs, opts?: pulumi.CustomResourceOptions) {
    super(cfTunnelDrainerProvider, name, args, opts)
  }
}
