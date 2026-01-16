import * as hcloud from '@pulumi/hcloud'
import * as pulumi from '@pulumi/pulumi'
import { mainKey, placementGroup, firewall } from '.'

const config = new pulumi.Config()
export const cfAccountId = config.requireSecret('cloudflareAccountId')
export const cfZoneId = config.requireSecret('cloudflareZoneId')
export const cfztOrgName = config.requireSecret('cloudflareZeroTrustOrgName')
export const orgAuthDomain = pulumi.interpolate`${cfztOrgName}.cloudflareaccess.com`
export const domainName = config.requireSecret('domainName')
export const sshPublicKey = config.require('sshPublicKey')

const cfConfig = new pulumi.Config('cloudflare')
export const cfApiToken = cfConfig.requireSecret('apiToken')

export const CONTROL_PLANE_GROUP_NAME = 'ctrl'
export const WORKER_GROUP_NAME = 'worker'
export const CONTROL_PLANE_NODE_COUNT = 1
export const WORKER_NODE_COUNT = 1
export const CONTROL_PLANE_STARTING_IP_OFFSET = 10
export const WORKER_STARTING_IP_OFFSET = 20
