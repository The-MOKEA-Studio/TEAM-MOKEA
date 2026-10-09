# Nix packaging and modules

This directory contains the Nix package, NixOS module, and Home Manager module
for Team Mokea.

## Flake outputs

For each supported system, `flake.nix` exports:

- `packages.${system}.team-mokea`
- `packages.${system}.default`
- `apps.${system}.team-mokea`
- `apps.${system}.default`

It also exports:

- `nixosModules.team-mokea`
- `nixosModules.default`
- `homeManagerModules.team-mokea`
- `homeManagerModules.default`
- `checks.${system}.package` (the package build)
- `checks.${system}.nixos-module` (NixOS VM test; Linux only)

Supported package systems are:

- `x86_64-linux`
- `aarch64-linux`
- `x86_64-darwin`
- `aarch64-darwin`

## Package

`package.nix` packages Team Mokea as a direct Node application.

- `version` comes from `package.json`.
- `src` is the repository checkout via `lib.cleanSource ../.`.
- The install phase copies runtime files into `$out/share/team-mokea`.
- The wrapper runs `src/index.js` with pinned Nixpkgs `nodejs_24`.
- The build does not run `npm install`, invoke Bun, or fetch package registry
  dependencies. Team Mokea currently uses Node built-ins and local source files
  at runtime.
- The wrapper sets `TEAM_MOKEA_DISABLE_AUTOUPDATE=1` by default so Nix package
  invocations do not check npm or attempt a global mutable self-update.

Build the package from this repository:

```sh
nix build --no-update-lock-file .#team-mokea
```

Run the packaged CLI:

```sh
nix run --no-update-lock-file .#team-mokea -- help
```

Run a server manually:

```sh
nix run --no-update-lock-file .#team-mokea -- server --headless
```

This is intentionally a clean wrapper around the repository source. There is no
separate source tarball hash in `package.nix`; the Team Mokea source state is
pinned by Git history.

## NixOS module

Import the module and enable `services.team-mokea`:

```nix
{
  inputs.team-mokea.url = "github:The-MOKEA-Studio/TEAM-MOKEA";

  outputs =
    { nixpkgs, team-mokea, ... }:
    {
      nixosConfigurations.host = nixpkgs.lib.nixosSystem {
        system = "x86_64-linux";
        modules = [
          team-mokea.nixosModules.default
          ({ config, ... }: {
            services.team-mokea = {
              enable = true;
              host = "0.0.0.0";
              port = 3456;
              openFirewall = true;
              configSource = config.sops.secrets.team-mokea-config.path;
            };

            sops.secrets.team-mokea-config = {
              owner = "team-mokea";
              group = "team-mokea";
              mode = "0400";
            };
          })
        ];
      };
    };
}
```

The NixOS module creates `team-mokea.service`, a `team-mokea` system user/group
by default, a private `/var/lib/team-mokea` state directory, and optionally
installs the CLI into `environment.systemPackages`.

Important options:

- `services.team-mokea.package`: package to run.
- `services.team-mokea.installPackage`: install the CLI system-wide.
- `services.team-mokea.configFile`: mutable Team Mokea config path. Defaults to
  `/var/lib/team-mokea/team-mokea.json`.
- `services.team-mokea.configSource`: optional seed config copied only when
  `configFile` does not already exist.
- `services.team-mokea.host`: optional `TEAM_MOKEA_HOST` override. Use
  `0.0.0.0` for LAN access.
- `services.team-mokea.port`: port used for firewall opening. Team Mokea reads
  the actual listen port from its config file.
- `services.team-mokea.openFirewall`: open `port` in the NixOS firewall.
- `services.team-mokea.logDirectory`: optional `--log-to` directory.
- `services.team-mokea.environment`: extra service environment.
- `services.team-mokea.serviceConfig`: extra systemd settings.

The module runs `team-mokea server --headless`. The config file must remain
mutable because Team Mokea persists refreshed OAuth tokens, account changes,
routes, quota settings, and runtime state next to the config.

## Home Manager module

Import the Home Manager module when you want Team Mokea as a user service:

```nix
{ config, inputs, ... }:

{
  imports = [
    inputs.team-mokea.homeManagerModules.default
  ];

  services.team-mokea = {
    enable = true;
    configSource = config.sops.secrets.team-mokea-config.path;
  };

  sops.secrets.team-mokea-config = {
    mode = "0400";
  };
}
```

The Home Manager module creates `systemd.user.services.team-mokea`, optionally
adds the CLI to `home.packages`, and defaults the mutable config path to
`${XDG_CONFIG_HOME}/team-mokea.json`.

Important options:

- `services.team-mokea.package`: package to run.
- `services.team-mokea.installPackage`: install the CLI in `home.packages`.
- `services.team-mokea.configFile`: mutable Team Mokea config path.
- `services.team-mokea.configSource`: optional user-readable seed config copied
  only when `configFile` does not already exist.
- `services.team-mokea.stateDirectory`: user service working directory. Defaults
  to `${XDG_STATE_HOME}/team-mokea`.
- `services.team-mokea.host`: optional `TEAM_MOKEA_HOST` override.
- `services.team-mokea.logDirectory`: optional `--log-to` directory.
- `services.team-mokea.environment`: extra user service environment.
- `services.team-mokea.serviceConfig`: extra systemd user service settings.

Start or inspect the user service with:

```sh
systemctl --user start team-mokea.service
systemctl --user status team-mokea.service
```

## Secrets, LAN access, and MITM CA

Team Mokea's config contains sensitive data: `proxy.apiKey`, OAuth refresh
tokens, access tokens, optional API-key accounts, account routing, and sx.org
settings. Keep the seed config in sops-nix or an equivalent secret system.

For LAN access:

- set `services.team-mokea.host = "0.0.0.0"` or set `proxy.host` in the config;
- set a strong `proxy.apiKey` in the config;
- open the firewall only on the intended network path;
- give clients both the proxy URL and `proxy.apiKey`.

For normal base-URL clients:

```sh
ANTHROPIC_BASE_URL=http://team-mokea-host:3456 \
ANTHROPIC_API_KEY='<proxy.apiKey>' \
claude -p 'Reply with exactly: ok'
```

For MITM/forward-proxy mode, clients also need Team Mokea's generated CA
certificate. Team Mokea stores MITM files next to `TEAM_MOKEA_CONFIG`:

- `team-mokea-ca.pem`: CA certificate clients must trust;
- `team-mokea-leaf.pem`: generated server leaf certificate;
- `team-mokea-leaf.key`: generated server leaf private key.

The CA private key is not persisted. If the MITM files are missing or no longer
cover the upstream host, Team Mokea regenerates the chain, which changes the CA
certificate clients need to trust.

Practical sops guidance:

- store the initial `team-mokea.json` seed in sops because it contains
  `proxy.apiKey` and account credentials;
- after the first MITM run, export `team-mokea-ca.pem` to the client machines
  through sops-nix if those clients should use forward-proxy mode;
- back up or manage `team-mokea-ca.pem`, `team-mokea-leaf.pem`, and
  `team-mokea-leaf.key` if you need the CA trust anchor to survive service state
  replacement or host migration;
- do not put these files in the Nix store.

Example client-side environment for MITM mode:

```sh
HTTPS_PROXY=http://<proxy.apiKey>@team-mokea-host:3456 \
NODE_EXTRA_CA_CERTS=/run/secrets/team-mokea-ca.pem \
claude -p 'Reply with exactly: ok'
```

For curl validation:

```sh
curl --proxy http://<proxy.apiKey>@team-mokea-host:3456 \
  --cacert /run/secrets/team-mokea-ca.pem \
  https://www.example.org/
```

## Tests

The flake exposes its tests as `checks`, so `nix flake check` runs them all:

```sh
nix flake check --no-update-lock-file -L
```

- `checks.${system}.package` builds the package on every supported system.
- `checks.${system}.nixos-module` (Linux only) is a full NixOS VM test
  (`nix/tests/module.nix`): it boots a VM with `services.team-mokea` enabled and
  a seeded config, waits for the unit and its port, and asserts
  `/team-mokea/status` responds with the seeded account — end-to-end coverage of
  the package, the module wiring, and config seeding. It uses an `apikey`
  account so startup makes no network calls (VM tests have no network).

The VM test needs KVM on the runner (GitHub-hosted `ubuntu-latest` provides
`/dev/kvm`).

## CI

The `CI` workflow runs on pushes and pull requests for `master`, and can also be
dispatched manually. Alongside the Node test/lint matrix it runs:

- `nix flake check` (package build on the runner's system + the NixOS VM test);
- a smoke test of the CLI wrapper with
  `nix run --no-update-lock-file .#team-mokea -- help`;
- a stable aggregate `test` job that branch protection can require.

## Updating the flake lock

Because the package uses the repository checkout as `src`, there is no upstream
source hash to manage — the Team Mokea source is pinned by the Git commit
itself. The only Nix hash in play is the nixpkgs lock in `flake.lock`; refresh it
with `nix flake update` when you want a newer nixpkgs pin.
