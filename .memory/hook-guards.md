# PreToolUse Hook Guards Reference

Global hook at `~/.claude/hooks/pre_tool_use.py` — applies to ALL projects.

Updated: 2026-02-07

## How It Works

The `PreToolUse` hook intercepts every tool call before execution and makes one of three decisions:
- **deny** — blocks the tool call entirely, reason sent back to Claude
- **ask** — shows a permission prompt to the human with context
- **pass through** — lets the normal permission system handle it

## Hard Denials (Blocked Entirely)

These operations are **permanently blocked** and must be run manually outside Claude.

### Destructive cpln CLI Commands (Bash)

| Pattern | Description |
|---------|-------------|
| `cpln gvc delete` | Destroys entire GVC and all workloads |
| `cpln workload delete` | Removes running workload |
| `cpln secret delete` | Permanently removes secret |
| `cpln policy delete` | Removes access control policy |
| `cpln volumeset delete` | Destroys persistent storage |
| `cpln domain delete` | Removes domain routing |
| `cpln group delete` | Removes org group |
| `cpln cloudaccount delete` | Removes cloud integration |
| `cpln image delete` | Removes container image from registry |
| `cpln serviceaccount delete` | Removes service account |
| `cpln identity delete` | Removes workload identity |
| `cpln agent delete` | Removes agent |
| `cpln org delete` | Attempts to delete organization |

### Destructive cpln MCP Tools

| Tool | Description |
|------|-------------|
| `mcp__cpln__delete_gvc` | Destroys entire GVC and all workloads |
| `mcp__cpln__delete_workload` | Removes running workload, stops containers |
| `mcp__cpln__delete_secret` | Permanently removes secret (dictionary = many keys gone) |
| `mcp__cpln__delete_policy` | Removes access control policy |
| `mcp__cpln__delete_volumeset` | Destroys persistent storage and data |
| `mcp__cpln__delete_domain` | Removes domain routing |
| `mcp__cpln__delete_group` | Removes org group and memberships |
| `mcp__cpln__delete_cloud_account` | Removes cloud provider integration |

### Other Blocked Operations

| Category | What's blocked |
|----------|---------------|
| Production deploy | Any cpln command targeting `--gvc production` or MCP tool with `gvc=production` |
| Dangerous rm | `rm -rf`, recursive deletes on `/`, `~`, `*`, `..` |
| Destructive DB | `migrate:fresh`, `migrate:reset`, `db:wipe`, `DROP TABLE`, `TRUNCATE` |
| npm/npx | All npm and npx commands |
| git add .js | `git add *.js` or `git add .` / `git add -A` |
| IDE autoexec | `.vscode/tasks.json`, git hooks, JetBrains run configs, etc. |
| .env files | Reading/writing `.env` files (allows `.env.sample`) |
| Path traversal | `../` in file paths |

## Ask Human (Requires Approval)

These operations show context and wait for human to approve or deny.

### Git Operations

| Operation | What happens |
|-----------|-------------|
| `git commit` | Shows staged changes, commit message, scans for secrets, asks to approve |
| `git push` | Scans all unpushed commits for secrets/API keys/.env files, shows report, asks to approve |
| `git push --force` | Shows force-push warning, suggests `--force-with-lease` |

### Mutative cpln CLI Commands (Bash)

| Pattern | Risk |
|---------|------|
| `cpln gvc patch` | Can wipe ALL env vars with partial update |
| `cpln secret patch` | Partial secret update |
| `cpln workload patch` | Partial workload update |
| `cpln apply` | Applies manifest (must contain ALL fields or data gets wiped) |
| `cpln workload force-redeployment` | Forces pod restart |
| `cpln workload stop` | Halts traffic immediately |
| `cpln workload create` | Deploys new containers |
| `cpln gvc create` | Provisions new infrastructure |
| `cpln secret create` | Creates new secret |
| `cpln workload update` | Modifies running workload |
| `cpln secret update` | Modifies secret data |
| `cpln gvc update` | Modifies GVC configuration |
| `cpln workload scale` | Changes replica count |

### Mutative cpln MCP Tools

| Tool | Risk |
|------|------|
| `mcp__cpln__update_gvc` | Can overwrite env vars (partial updates wipe all!) |
| `mcp__cpln__update_secret` | Modifies secret data |
| `mcp__cpln__update_workload` | Modifies running workload, may cause restarts |
| `mcp__cpln__create_gvc` | Provisions new infrastructure |
| `mcp__cpln__create_workload` | Deploys new containers |
| `mcp__cpln__create_secret` | Adds secret to infrastructure |
| `mcp__cpln__create_policy` | Adds access control policy |
| `mcp__cpln__create_domain` | Provisions domain routing |
| `mcp__cpln__remove_gvc_locations` | Removes deployment regions |
| `mcp__cpln__cpln_resource_operation` | Generic escape hatch, can do anything |

## Secret Scanning (Git Push)

When `git push` is intercepted, the hook scans all unpushed commits for:

- Passwords, API keys, secrets, tokens
- Stripe keys (`sk_live_`, `sk_test_`, `pk_live_`)
- GitHub tokens (`ghp_`, `gho_`)
- AWS keys (`AKIA...`)
- Private keys (`-----BEGIN PRIVATE KEY-----`)
- JWTs (`eyJ...`)
- Slack tokens (`xox...`)
- Database passwords
- Service API keys (SendGrid, Twilio, Mailgun, Stripe)
- Committed `.env` files

## Settings.json Deny List

In addition to the hook, `~/.claude/settings.json` has a permissions deny list:

```json
"deny": [
    "Bash(git push --force)",
    "Bash(git push -f)",
    "Bash(git reset --hard)",
    "Bash(rm -rf *)",
    "Bash(rm -rf)",
    "Bash(sudo *)",
    "Bash(./vendor/bin/sail artisan migrate:fresh)",
    "Bash(./vendor/bin/sail artisan db:wipe)",
    "Bash(npm *)",
    "Bash(npx *)"
]
```

Note: `git push:*` blanket deny was removed — push is now handled by the hook with secret scanning + human approval.
