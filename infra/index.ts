import * as pulumi from '@pulumi/pulumi'
import * as hcloud from '@pulumi/hcloud'
import * as cloudflare from '@pulumi/cloudflare'
import * as tls from '@pulumi/tls'
import * as command from '@pulumi/command'
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

const mainKey = new hcloud.SshKey('main-key', {
  publicKey: sshPublicKey,
  name: 'admin-key',
})

const placementGroup = new hcloud.PlacementGroup('k3s-spread', {
  type: 'spread',
})

const sshCaKey = new tls.PrivateKey('ssh-ca-key', { algorithm: 'ED25519' })

const signHostKey = (
  name: string,
  caKey: tls.PrivateKey,
  hostPublicKey: pulumi.Input<string>,
  principals: pulumi.Input<any>[],
) => {
  return new command.local.Command(`${name}-sign-cert`, {
    create: pulumi.interpolate`
      DIR=$(mktemp -d)
      trap "rm -rf $DIR" EXIT
      echo "${caKey.privateKeyOpenssh}" > $DIR/ca_key
      echo "${caKey.publicKeyOpenssh}" > $DIR/ca_key.pub
      chmod 600 $DIR/ca_key
      echo "${hostPublicKey}" > $DIR/host_key.pub
      # Sign with 10 year validity
      ssh-keygen -s $DIR/ca_key -I "${name}" -h -n "${pulumi.all(principals).apply(p => p.join(','))}" -V +520w $DIR/host_key.pub > /dev/null
      cat $DIR/host_key-cert.pub
    `,
    triggers: [hostPublicKey],
  }).stdout
}

const createNode = (
  groupName: string,
  i: number,
  ipOffset: number,
  role: 'control-plane' | 'worker',
  overrides?: Partial<hcloud.ServerArgs>,
) => {
  const name = generateServerName(groupName, i)
  const ip = `10.0.1.${ipOffset + i}`

  const nodeHostKey = new tls.PrivateKey(`${name}-host-key`, { algorithm: 'ED25519' })
  const bastionHost = pulumi.interpolate`ssh.${domainName}`
  const cert = signHostKey(name, sshCaKey, nodeHostKey.publicKeyOpenssh, [bastionHost, ip, name])

  const args = {
    serverType: 'cax21',
    image: 'ubuntu-24.04',
    location: 'nbg1',
    sshKeys: [mainKey.id],
    placementGroupId: placementGroup.id.apply(id => parseInt(id)),
    firewallIds: [firewall.id.apply(id => parseInt(id))],
    publicNets: [{ ipv4Enabled: true, ipv6Enabled: true }],
    labels: { cluster: 'k3s-main', role },
    userData: createCloudConfig(nodeHostKey.privateKeyOpenssh, nodeHostKey.publicKeyOpenssh, cert),
    ...overrides,
  }
  const server = new hcloud.Server(name, args, { dependsOn: [subnet] })

  new hcloud.ServerNetwork(
    `${name}-net`,
    {
      serverId: server.id.apply(id => parseInt(id)),
      networkId: network.id.apply(id => parseInt(id)),
      ip,
    },
    { deleteBeforeReplace: true }, // prevent "IP not available" errors
  )
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
  .all([sshCaKey.publicKeyOpenssh, domainName])
  .apply(([key, domain]) => `@cert-authority *.${domain},ssh.${domain},10.0.1.* ${key.trim()}\n`)
