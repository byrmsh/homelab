import * as pulumi from '@pulumi/pulumi'
import * as hcloud from '@pulumi/hcloud'
import * as cloudflare from '@pulumi/cloudflare'
import * as tls from '@pulumi/tls'
import {
  cfZoneId,
  sshPublicKey,
  WORKER_GROUP_NAME,
  CONTROL_PLANE_GROUP_NAME,
  CONTROL_PLANE_NODE_COUNT,
  WORKER_NODE_COUNT,
  CONTROL_PLANE_STARTING_IP_OFFSET,
  WORKER_STARTING_IP_OFFSET,
  domainName,
} from './config'
import { infraTunnel, createCloudConfig } from './tunnel'
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
  { dependsOn: [network] },
)

export const firewall = new hcloud.Firewall('k3s-firewall', {
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

const wildcardCname = new cloudflare.DnsRecord('wildcard-cname', {
  zoneId: cfZoneId,
  name: '*',
  type: 'CNAME',
  content: pulumi.interpolate`${infraTunnel.id}.cfargotunnel.com`,
  proxied: true,
  ttl: 1,
})

const rootCname = new cloudflare.DnsRecord('root-cname', {
  zoneId: cfZoneId,
  name: '@',
  type: 'CNAME',
  content: pulumi.interpolate`${infraTunnel.id}.cfargotunnel.com`,
  proxied: true,
  ttl: 1,
})

export const mainKey = new hcloud.SshKey('main-key', {
  publicKey: sshPublicKey,
  name: 'admin-key',
})

export const placementGroup = new hcloud.PlacementGroup('k3s-spread', {
  type: 'spread',
})

// Shared host key for all nodes to allow random load balancing via Cloudflared
const clusterSshHostKey = new tls.PrivateKey('cluster-ssh-host-key', { algorithm: 'ED25519' })

const createNode = (
  groupName: string,
  i: number,
  ipOffset: number,
  role: 'control-plane' | 'worker',
  overrides?: Partial<hcloud.ServerArgs>,
) => {
  const name = generateServerName(groupName, i)
  const ip = `10.0.1.${ipOffset + i}`

  const args = {
    serverType: 'cax21',
    image: 'ubuntu-24.04',
    location: 'nbg1',
    sshKeys: [mainKey.id],
    placementGroupId: placementGroup.id.apply(id => parseInt(id)),
    firewallIds: [firewall.id.apply(id => parseInt(id))],
    publicNets: [{ ipv4Enabled: true, ipv6Enabled: true }],
    labels: { cluster: 'k3s-main', role },
    userData: createCloudConfig(
      clusterSshHostKey.privateKeyOpenssh,
      clusterSshHostKey.publicKeyOpenssh,
    ),
    ...overrides,
  }
  const server = new hcloud.Server(name, args, { dependsOn: [subnet] })

  new hcloud.ServerNetwork(`${name}-net`, {
    serverId: server.id.apply(id => parseInt(id)),
    networkId: network.id.apply(id => parseInt(id)),
    ip,
  })
  return { server, ip }
}

const ctrlNodes = enumerate(CONTROL_PLANE_NODE_COUNT).map(i =>
  createNode(CONTROL_PLANE_GROUP_NAME, i, CONTROL_PLANE_STARTING_IP_OFFSET, 'control-plane'),
)
const workerNodes = enumerate(WORKER_NODE_COUNT).map(i =>
  createNode(WORKER_GROUP_NAME, i, WORKER_STARTING_IP_OFFSET, 'worker'),
)

const ctrls = ctrlNodes.map(node => node.server)
const workers = workerNodes.map(node => node.server)

export const knownHostsFile = pulumi
  .all([clusterSshHostKey.publicKeyOpenssh, domainName])
  .apply(([key, domain]) => {
    const bastion = `ssh.${domain} ${key}\n`
    const ipsFor = (count: number, offset: number) =>
      enumerate(count).map(i => `10.0.1.${offset + i} ${key}\n`)
    return [
      bastion,
      ...ipsFor(CONTROL_PLANE_NODE_COUNT, CONTROL_PLANE_STARTING_IP_OFFSET),
      ...ipsFor(WORKER_NODE_COUNT, WORKER_STARTING_IP_OFFSET),
    ].join('')
  })
