import * as pulumi from '@pulumi/pulumi'

const config = new pulumi.Config()
export const cfAccountId = config.requireSecret('cloudflareAccountId')
export const cfZoneId = config.requireSecret('cloudflareZoneId')
export const cfztOrgName = config.requireSecret('cloudflareZeroTrustOrgName')
export const orgAuthDomain = pulumi.interpolate`${cfztOrgName}.cloudflareaccess.com`
export const domainName = config.requireSecret('domainName')
export const sshPublicKey = config.require('sshPublicKey')

const cfConfig = new pulumi.Config('cloudflare')
export const cfApiToken = cfConfig.requireSecret('apiToken')

export const WORKER_GROUP_NAME = 'worker'
export const CONTROL_PLANE_GROUP_NAME = 'ctrl'
export const WORKER_NODE_COUNT = 2
export const CONTROL_PLANE_NODE_COUNT = 3
