# AGENTS.md - Agentic Coding Guidelines

## Repository: github.com:byrmsh/homelab

This is a Pulumi-based Infrastructure-as-Code (IaC) project for managing a personal homelab infrastructure on Hetzner Cloud with Cloudflare Zero Trust integration.

## Project Structure

```
/
├── infra/           # Pulumi TypeScript infrastructure code
│   ├── index.ts     # Main infrastructure resources
│   ├── config.ts    # Configuration & secrets
│   ├── tunnel.ts    # Cloudflare tunnel configuration
│   ├── tunnel-drainer.ts  # Custom Pulumi resource for tunnel cleanup
│   └── utils.ts     # Utility functions
├── ansible/         # Ansible playbooks and roles (currently empty)
├── k8s/            # Kubernetes manifests (currently empty)
└── .prettierrc     # Code formatting configuration
```

## Build & Development Commands

### Infrastructure (infra/)

All commands must be run from the `infra/` directory:

```bash
cd /home/mesh/Projects/Bash/homelab/infra

# Install dependencies
pnpm install

# Format code
pnpm exec prettier --write .

# Check formatting
pnpm exec prettier --check .

# Type check
pnpm exec tsc --noEmit

# Preview infrastructure changes
pulumi preview

# Deploy infrastructure
pulumi up

# Destroy infrastructure
pulumi destroy

# View stack outputs
pulumi stack output

# View current state
pulumi stack
```

### Package Manager

This project uses **pnpm** exclusively (version 10.28.0+). Do NOT use npm or yarn.

## Code Style Guidelines

### TypeScript

- **Target**: ES2020
- **Module**: CommonJS
- **Strict mode**: Enabled - always use strict TypeScript
- **Quotes**: Single quotes
- **Semicolons**: None (omitted)
- **Indent**: 2 spaces
- **Print width**: 100 characters
- **Arrow parens**: Avoid when possible

### Imports

- Use named imports from local modules: `import { foo } from './config'`
- Group imports: 1) external libraries, 2) local modules
- Use `* as` for Pulumi packages: `import * as pulumi from '@pulumi/pulumi'`
- NEVER create circular imports (config.ts currently imports from index.ts - this is a bug)

### Naming Conventions

- **Variables/Functions**: camelCase (`createNode`, `tunnelSecret`)
- **Constants**: UPPER_SNAKE_CASE for config values (`CONTROL_PLANE_NODE_COUNT`)
- **Pulumi Resources**: PascalCase with descriptive names (`hcloud.Network('k3s-net')`)
- **Files**: kebab-case for multi-word files (`tunnel-drainer.ts`)
- **Interfaces/Types**: PascalCase (`CfTunnelDrainerInputs`)

### Error Handling

- Use Pulumi's `.apply()` for async operations on Outputs
- For custom resources, implement proper error handling in providers
- Use `pulumi.all()` when combining multiple Outputs
- Log appropriately with console.log for operational visibility

### Types

- Always define interfaces for complex objects
- Use `pulumi.Input<T>` and `pulumi.Output<T>` for Pulumi resource properties
- Prefer explicit return types on exported functions
- Avoid `any` - use unknown if type is truly uncertain

### Pulumi Best Practices

- Set `dependsOn` for explicit resource dependencies
- Use `deleteBeforeReplace` for resources with unique constraints (IPs, names)
- Export important values at the end of index.ts
- Keep secrets in Pulumi config, never hardcode
- Use descriptive resource names with kebab-case

### Formatting

Always run Prettier before committing:
```bash
pnpm exec prettier --write .
```

## Testing

**No test framework is currently configured.**

When adding tests:
1. Add Jest or Vitest to devDependencies
2. Create a `tests/` directory in `infra/`
3. Add test scripts to package.json
4. Use the naming pattern: `*.test.ts` or `*.spec.ts`

## Linting

**No linter is currently configured.**

Consider adding ESLint with:
- @typescript-eslint/parser
- @typescript-eslint/recommended
- Prettier integration (eslint-config-prettier)

## Secrets Management

- NEVER commit secrets to git
- Use Pulumi config: `pulumi config set --secret keyName value`
- Required secrets (set in Pulumi.dev.yaml):
  - `cloudflareAccountId`
  - `cloudflareZoneId`
  - `cloudflareZeroTrustOrgName`
  - `domainName`
  - `sshPublicKey`
  - `cloudflare:apiToken`

## Infrastructure Resources

The project creates:
- Hetzner Cloud servers (cax21 instances) for k3s cluster
- Cloudflare Zero Trust tunnels for secure access
- SSH CA-based host key signing
- Cloudflare DNS records
- Network subnets and firewalls

## Pre-deployment Checklist

1. Run `pnpm exec prettier --check .` - should pass
2. Run `pnpm exec tsc --noEmit` - no type errors
3. Run `pulumi preview` - review all changes
4. Verify secrets are configured: `pulumi config`
