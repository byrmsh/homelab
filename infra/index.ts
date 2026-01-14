import * as pulumi from '@pulumi/pulumi'
import * as hcloud from '@pulumi/hcloud'
import * as cloudflare from '@pulumi/cloudflare'
import { cfZoneId, sshPublicKey } from './config'
import { tunnelRoute, infraTunnel } from './tunnel'
import { generateServerName, CF_TUNNEL_CLOUD_CONFIG, enumerate } from './utils'

const network = new hcloud.Network('k3s-net', {
  ipRange: '10.0.0.0/16',
  labels: { env: 'production' },
})

const subnet = new hcloud.NetworkSubnet(
  'k3s-subnet',
  {
    networkId: network.id.apply(id => parseInt(id)),
    networkZone: 'eu-central',
    type: 'cloud',
    ipRange: '10.0.0.0/16',
  },
  { dependsOn: [network] },
)

const firewall = new hcloud.Firewall('k3s-firewall', {
  rules: [
    {
      direction: 'in',
      protocol: 'tcp',
      port: 'any',
      sourceIps: ['10.0.0.0/16'],
    },
    {
      direction: 'in',
      protocol: 'udp',
      port: 'any',
      sourceIps: ['10.0.0.0/16'],
    },
    {
      direction: 'in',
      protocol: 'icmp',
      sourceIps: ['0.0.0.0/0', '::/0'],
    },
  ],
})

export const wildcardCname = new cloudflare.DnsRecord('wildcard-cname', {
  zoneId: cfZoneId,
  name: '*',
  type: 'CNAME',
  content: pulumi.interpolate`${infraTunnel.id}.cfargotunnel.com`,
  proxied: true,
  ttl: 1,
})

export const rootCname = new cloudflare.DnsRecord('root-cname', {
  zoneId: cfZoneId,
  name: '@',
  type: 'CNAME',
  content: pulumi.interpolate`${infraTunnel.id}.cfargotunnel.com`,
  proxied: true,
  ttl: 1,
})

const mainKey = new hcloud.SshKey('main-key', {
  publicKey: sshPublicKey,
  name: 'admin-key',
})

const placementGroup = new hcloud.PlacementGroup('k3s-spread', {
  type: 'spread',
})

const DEFAULT_SERVER_ARGS: hcloud.ServerArgs = {
  serverType: 'cax21',
  image: 'ubuntu-24.04',
  sshKeys: [mainKey.id],
  placementGroupId: placementGroup.id.apply(id => parseInt(id)),
  firewallIds: [firewall.id.apply(id => parseInt(id))],
  publicNets: [{ ipv4Enabled: true, ipv6Enabled: true }],
  labels: { cluster: 'k3s-main' },
}

const createControlPlane = (
  i: number,
  overrides?: Partial<hcloud.ServerArgs>,
) => {
  const name = generateServerName('ctrl', i)
  const CUSTOM_SERVER_ARGS: Partial<hcloud.ServerArgs> = {
    userData: CF_TUNNEL_CLOUD_CONFIG,
    labels: { ...DEFAULT_SERVER_ARGS.labels, role: 'control-plane' },
  }
  const args = { ...DEFAULT_SERVER_ARGS, ...CUSTOM_SERVER_ARGS, ...overrides }
  const server = new hcloud.Server(name, args, {
    dependsOn: [subnet, tunnelRoute],
  })
  new hcloud.ServerNetwork(`${name}-net`, {
    serverId: server.id.apply(id => parseInt(id)),
    networkId: network.id.apply(id => parseInt(id)),
    ip: `10.0.1.${10 + i}`,
  })
  return server
}

const createWorkerNode = (
  i: number,
  overrides?: Partial<hcloud.ServerArgs>,
) => {
  const name = generateServerName('worker', i)
  const CUSTOM_SERVER_ARGS: Partial<hcloud.ServerArgs> = {
    userData: CF_TUNNEL_CLOUD_CONFIG,
    labels: { ...DEFAULT_SERVER_ARGS.labels, role: 'worker' },
  }
  const args = { ...DEFAULT_SERVER_ARGS, ...CUSTOM_SERVER_ARGS, ...overrides }
  const server = new hcloud.Server(name, args, {
    dependsOn: [subnet, tunnelRoute],
  })
  new hcloud.ServerNetwork(`${name}-net`, {
    serverId: server.id.apply(id => parseInt(id)),
    networkId: network.id.apply(id => parseInt(id)),
    ip: `10.0.1.${20 + i}`,
  })
  return server
}

export const ctrls = enumerate(1).map(i => createControlPlane(i))
export const workers = enumerate(1).map(i => createWorkerNode(i))
