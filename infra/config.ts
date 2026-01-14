import * as pulumi from '@pulumi/pulumi'

const config = new pulumi.Config()
export const cfAccountId = config.requireSecret('cloudflareAccountId')
export const cfZoneId = config.requireSecret('cloudflareZoneId')
export const cfztOrgName = config.requireSecret('cloudflareZeroTrustOrgName')
export const domainName = config.requireSecret('domainName')
export const adminEmail = config.requireSecret('adminEmail')
export const sshPublicKey = config.require('sshPublicKey')

export const orgAuthDomain = pulumi.interpolate`${cfztOrgName}.cloudflareaccess.com`
