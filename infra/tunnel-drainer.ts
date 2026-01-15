import * as pulumi from '@pulumi/pulumi'

type CfString = string | pulumi.Output<string>

interface CfTunnelDrainerInputs {
  accountId: CfString
  tunnelId: CfString
  apiToken: CfString
}

const cfTunnelDrainerProvider: pulumi.dynamic.ResourceProvider = {
  async create(inputs: CfTunnelDrainerInputs) {
    return { id: 'drainer-' + inputs.tunnelId, outs: inputs }
  },

  async delete(_id: string, props: CfTunnelDrainerInputs) {
    const { accountId, tunnelId, apiToken } = props
    console.log(`Starting drain for tunnel: ${tunnelId}`)

    while (true) {
      const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/cfd_tunnel/${tunnelId}`

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
      })

      if (!response.ok) {
        if (response.status === 404) break
        console.warn(`API Error ${response.status}: ${response.statusText}`)
      } else {
        const data = await response.json()
        const status = data.result?.status

        if (status === 'inactive') {
          console.log(`Tunnel status is '${status}'. Proceeding with destruction.`)
          break
        }

        console.log(`Tunnel status is '${status}'. Waiting 2s...`)
      }

      await new Promise(r => setTimeout(r, 2_000))
    }
  },
}

export class CfTunnelDrainer extends pulumi.dynamic.Resource {
  constructor(name: string, args: CfTunnelDrainerInputs, opts?: pulumi.CustomResourceOptions) {
    super(cfTunnelDrainerProvider, name, args, opts)
  }
}
