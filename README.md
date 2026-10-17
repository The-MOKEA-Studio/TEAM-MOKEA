# Team Mokea

A community fork of [TeamClaude](https://github.com/KarpelesLab/teamclaude), rebranded and maintained by The MOKEA Studio.

[![CI](https://github.com/The-MOKEA-Studio/TEAM-MOKEA/actions/workflows/ci.yml/badge.svg)](https://github.com/The-MOKEA-Studio/TEAM-MOKEA/actions/workflows/ci.yml)
[![node](https://img.shields.io/badge/node-%3E%3D20-green)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Multi-account proxy for [Claude Code](https://claude.ai/claude-code) and [Codex](https://github.com/openai/codex): it pools Claude Max, ChatGPT/Codex, API-key and third-party backend accounts, and rotates on quota.

It sits between the coding agent and the provider's API, holds several accounts, and moves to the next one when the current account gets close to its session or weekly limit. The session keeps running instead of stopping on a 429. Claude accounts serve Claude Code, Codex accounts serve the Codex CLI, and both pools share one proxy.

**It is built for one person.** The "team" is the agents: someone running ten, or fifty, coding-agent sessions at once needs more than one subscription, and switching accounts by hand each time one fills up is what this replaces. Every account in the pool is your own, and the client is the provider's own CLI. It is not a way to share an account between people, and not a bridge for other clients onto subscription credentials — see [Scope](#scope).

![Team Mokea TUI](screenshots/team-mokea.png)

## Quick start

Node.js 20+ required.

```bash
npm install -g github:The-MOKEA-Studio/TEAM-MOKEA

team-mokea login     # browser OAuth, run it once per account
team-mokea server    # start the proxy, shows the TUI
team-mokea run       # in another terminal: Claude Code through the proxy
```

The package is installed from GitHub with npm; it is not currently available from the npm registry. Already logged into Claude Code? `team-mokea import` takes its credentials instead of a fresh OAuth round. For Docker server setup and automatic image updates, see [Running in a container](docs/usage.md#running-in-a-container). API keys, and one email holding accounts in several orgs, are covered in [docs/accounts.md](docs/accounts.md).

For Codex, use the same installation with its `codex` subcommand:

```bash
team-mokea codex import   # reuse your current Codex login
team-mokea codex server   # start the Codex proxy
team-mokea codex run      # in another terminal
```

The Codex commands use `~/.config/teamcodex.json` and port 3457 by default,
including accounts imported with `teamcodex codex import`. `team-mokea claude run`
is also accepted as an explicit spelling of `team-mokea run`.

Global installs automatically check GitHub for a newer version once a day and
apply updates on the next launch. Codex updates run in the background after a
session ends. Run `team-mokea update` (or `team-mokea codex update`) to update
manually. Disable checks with `TEAM_MOKEA_DISABLE_AUTOUPDATE=1` or
`"autoUpdate": false` in the provider's config. See [Auto-update](docs/usage.md#auto-update).

## What it does

- Rotates to the next account when the 5h session or 7d weekly bucket reaches the threshold (98% by default), preferring the account whose weekly quota resets soonest.
- Tracks the per-model weekly cap separately, so an account out of Fable quota is skipped for Fable requests and still serves Opus and Sonnet.
- Tells a spent quota bucket apart from a per-minute rate limit and only rotates on the first one. Rotating on a rate limit would just move the burst to the next account and drop the warm cache, so it paces the same account instead.
- Paces requests onto a freshly switched account, so a herd of agents failing over at the same instant doesn't throttle it and cascade down the fleet.
- TUI with quota bars, reset countdowns, activity log, and settings you can change while it runs, including adding and removing accounts.
- Opt-in MCP endpoint that hands the same control plane to Claude Code as tools, so an agent can read the fleet's quota or switch accounts from inside a session.
- Catches hardcoded `api.anthropic.com` endpoints (the Claude Design MCP, for one) through a local MITM forward proxy, not only what `ANTHROPIC_BASE_URL` covers.
- Holds the request open until quota resets instead of returning 429 when every account is spent, so an unattended run finishes on its own (`holdSeconds`, off by default).
- Optionally leans on accounts with Anthropic's paid extra usage once every account is out of free quota, instead of returning 429 (`allowExtraUsage`, off by default — it bills real money). Quota between the switch threshold and 100% is used first, on any account; billing starts only when none is left, and stops as soon as a window resets.
- Refreshes OAuth tokens before they expire and writes them back to config. Client refreshes pass through untouched.
- Pools OpenAI Codex subscriptions alongside Claude accounts (experimental): the Codex CLI is routed through the same proxy, by config or transparently through the MITM proxy, and rotates on its own quota.
- Takes any Anthropic-compatible API (DeepSeek, GLM) as a low-priority fallback for when the Claude accounts are done.
- Sends one account's traffic through its own HTTP or SOCKS proxy (`login --routing "socks5h://user:pass@host:1080"`), sign-in and token refresh included, and leaves every other account alone. If that proxy goes down, the request fails over to the next account.
- Claude proxy uses Node built-ins only. Codex commands use the bundled, commit-pinned TeamCodex dependency.

## Everyday commands

```bash
team-mokea accounts          # accounts with tier and token status
team-mokea status            # live proxy status, needs a running server
team-mokea disable <name>    # pause an account without removing it
team-mokea priority <name> 1 # rotation order, lower = preferred
team-mokea alias --install   # make plain `claude` go through the proxy
team-mokea help              # everything else
```

Full reference: [docs/usage.md](docs/usage.md).

## Configuration

Config is at `~/.config/team-mokea.json` (`$XDG_CONFIG_HOME` honoured) and is meant to be hand-editable. A proxy API key is generated on first use. Observed quota goes to a separate `team-mokea.state.json` next to it, safe to delete since quota gets re-learned from traffic.

Every field, plus environment variables and network tuning: [docs/configuration.md](docs/configuration.md).

## How it works

1. Claude Code talks to the local proxy instead of `api.anthropic.com`.
2. The proxy picks an eligible account, injects that account's real token, and rewrites `account_uuid` in the body to match.
3. `anthropic-ratelimit-unified-*` response headers feed the session (5h) and weekly (7d) quota view, which survives a restart.
4. At the threshold, rotation moves on. On a quota 429 the request is resent on another account, so the client never sees the limit while some account still has headroom.
5. Expiring tokens, transient network errors and client token refreshes are handled inside the proxy, so none of them interrupt the session.

Step-by-step lifecycle: [docs/routing.md](docs/routing.md#request-lifecycle).

## Documentation

| Page | Contents |
| --- | --- |
| [Accounts](docs/accounts.md) | OAuth login, import, API keys, multiple orgs, syncing tokens across machines via callback.net, per-account proxy routing, Codex accounts, third-party backends |
| [Usage](docs/usage.md) | Server and TUI, running Claude Code, shell alias, command reference, browser dashboard, MCP endpoint, logging |
| [Routing](docs/routing.md) | Rotation, the two kinds of 429, storm control, model routes, session spreading, pinning, prompt cache |
| [Quota](docs/quota.md) | Quota probe, keep-warm, holding on exhaustion |
| [Configuration](docs/configuration.md) | Config format, every field, environment variables, network tuning |
| [Proxy modes](docs/proxy-modes.md) | MITM forward proxy, upstream proxy, per-account routing, sx.org residential egress |
| [Compliance](docs/compliance.md) | Who the project is for, and terms of service notes for each provider |
| [Contributing](CONTRIBUTING.md) | What is in scope, and what a pull request needs |

## Rename compatibility

The project now uses the Team Mokea name and `team-mokea` command. Existing installations remain compatible: `teamclaude` is an alias, `TEAMCLAUDE_*` variables and `/teamclaude/…` control routes are still accepted, and an existing `~/.config/teamclaude.json` remains the fallback when `~/.config/team-mokea.json` is absent.

## Security

Report vulnerabilities through [GitHub private reporting](https://github.com/The-MOKEA-Studio/TEAM-MOKEA/security/advisories/new). Team Mokea is a community fork of the MIT-licensed upstream project; see [SECURITY.md](SECURITY.md) for provenance and reporting details.

## Scope

Team Mokea is a local proxy holding your own credentials and driving the provider's own CLI, for one person's work. That holds for every provider it supports, not only Anthropic:

- **One person, their own accounts.** Not account sharing, not a hosted service, not resale.
- **The provider's own client.** Claude Code on Claude accounts, the Codex CLI on Codex accounts. No support for other harnesses on subscription credentials.
- **A third-party backend is an account like any other:** a key you were issued, used under that vendor's terms.

How this lines up with the providers' terms, including the multi-subscription question people ask most, is written up in [docs/compliance.md](docs/compliance.md). Not legal advice. Changes that step outside this scope are not merged; see [CONTRIBUTING.md](CONTRIBUTING.md).

## Star history

<a href="https://www.star-history.com/?repos=The-MOKEA-Studio%2FTEAM-MOKEA&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=The-MOKEA-Studio/TEAM-MOKEA&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=The-MOKEA-Studio/TEAM-MOKEA&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=The-MOKEA-Studio/TEAM-MOKEA&type=date&legend=top-left" />
 </picture>
</a>

## License

MIT — see [LICENSE](LICENSE).
