import * as pulumi from '@pulumi/pulumi'
import * as hcloud from '@pulumi/hcloud'
import * as cloudflare from '@pulumi/cloudflare'
import {
  cfZoneId,
  sshPublicKey,
  WORKER_GROUP_NAME,
  CONTROL_PLANE_GROUP_NAME,
  CONTROL_PLANE_NODE_COUNT,
  WORKER_NODE_COUNT,
} from './config'
import { infraTunnel, CF_TUNNEL_CLOUD_CONFIG } from './tunnel'
import { generateServerName, enumerate } from './utils'

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
  { dependsOn: [network] }
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
  serverType: 'cax11',
  image: 'ubuntu-24.04',
  sshKeys: [mainKey.id],
  placementGroupId: placementGroup.id.apply(id => parseInt(id)),
  firewallIds: [firewall.id.apply(id => parseInt(id))],
  publicNets: [{ ipv4Enabled: true, ipv6Enabled: true }],
  labels: { cluster: 'k3s-main' },
}

const createControlPlane = (i: number, overrides?: Partial<hcloud.ServerArgs>) => {
  const name = generateServerName(CONTROL_PLANE_GROUP_NAME, i)
  const CUSTOM_SERVER_ARGS: Partial<hcloud.ServerArgs> = {
    userData: CF_TUNNEL_CLOUD_CONFIG,
    labels: { ...DEFAULT_SERVER_ARGS.labels, role: 'control-plane' },
  }
  const args = { ...DEFAULT_SERVER_ARGS, ...CUSTOM_SERVER_ARGS, ...overrides }
  const server = new hcloud.Server(name, args, {
    dependsOn: [subnet],
  })
  new hcloud.ServerNetwork(`${name}-net`, {
    serverId: server.id.apply(id => parseInt(id)),
    networkId: network.id.apply(id => parseInt(id)),
    ip: `10.0.1.${10 + i}`,
  })
  return server
}

const createWorkerNode = (i: number, overrides?: Partial<hcloud.ServerArgs>) => {
  const name = generateServerName(WORKER_GROUP_NAME, i)
  const CUSTOM_SERVER_ARGS: Partial<hcloud.ServerArgs> = {
    userData: CF_TUNNEL_CLOUD_CONFIG,
    labels: { ...DEFAULT_SERVER_ARGS.labels, role: 'worker' },
  }
  const args = { ...DEFAULT_SERVER_ARGS, ...CUSTOM_SERVER_ARGS, ...overrides }
  const server = new hcloud.Server(name, args, {
    dependsOn: [subnet],
  })
  new hcloud.ServerNetwork(`${name}-net`, {
    serverId: server.id.apply(id => parseInt(id)),
    networkId: network.id.apply(id => parseInt(id)),
    ip: `10.0.1.${20 + i}`,
  })
  return server
}

export const ctrls = enumerate(CONTROL_PLANE_NODE_COUNT).map(i => createControlPlane(i))
export const workers = enumerate(WORKER_NODE_COUNT).map(i => createWorkerNode(i))
