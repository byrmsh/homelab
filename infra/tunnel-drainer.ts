import * as pulumi from '@pulumi/pulumi'

type CfString = string | pulumi.Output<string>

interface CfTunnelDrainerInputs {
  accountId: CfString
  tunnelId: CfString
  apiToken: CfString
}

// API DOCS: https://developers.cloudflare.com/api/resources/zero_trust/subresources/tunnels/subresources/cloudflared/methods/get/
const getConnectionCount = async (accountId: string, tunnelId: string, apiToken: string) => {
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/cfd_tunnel/${tunnelId}`
  const headers = { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' }
  const response = await fetch(url, { method: 'GET', headers })
  if (!response.ok) throw new Error(`API Error ${response.status}: ${response.statusText}`)
  const data = await response.json()
  const connections = data.result?.connections
  if (!Array.isArray(connections))
    throw new Error('Unexpected API response structure: missing connections array')
  return connections.length
}

const checkStatusUntilDrained = async (accountId: string, tunnelId: string, apiToken: string) => {
  const count = await getConnectionCount(accountId, tunnelId, apiToken)
  if (count === 0) {
    console.log(`Tunnel has ${count} connections. Proceeding with destruction.`)
    return
  }
  console.log(`Tunnel has ${count} connections. Waiting 2s...`)
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
