{
  config,
  lib,
  pkgs,
  ...
}:

let
  cfg = config.services.team-mokea;

  inherit (lib)
    literalExpression
    mkEnableOption
    mkIf
    mkOption
    optionalString
    types
    ;

  defaultPackage = pkgs.callPackage ./package.nix { };
  configFile =
    if cfg.configFile == null then "${config.xdg.configHome}/team-mokea.json" else cfg.configFile;
  stateDirectory =
    if cfg.stateDirectory == null then "${config.xdg.stateHome}/team-mokea" else cfg.stateDirectory;

  serverArgs = [
    "server"
    "--headless"
  ]
  ++ lib.optionals (cfg.logDirectory != null) [
    "--log-to"
    cfg.logDirectory
  ]
  ++ cfg.extraArgs;

  preStart = pkgs.writeShellScript "team-mokea-user-pre-start" (
    ''
      set -eu

      config_dir="$(${pkgs.coreutils}/bin/dirname ${lib.escapeShellArg configFile})"
      ${pkgs.coreutils}/bin/install -d -m 0700 "$config_dir"
      ${pkgs.coreutils}/bin/install -d -m 0700 ${lib.escapeShellArg stateDirectory}
    ''
    + optionalString (cfg.configSource != null) ''

      if [ ! -e ${lib.escapeShellArg configFile} ]; then
        ${pkgs.coreutils}/bin/install -m 0600 \
          ${lib.escapeShellArg cfg.configSource} ${lib.escapeShellArg configFile}
      fi
    ''
    + optionalString (cfg.logDirectory != null) ''

      ${pkgs.coreutils}/bin/install -d -m 0700 ${lib.escapeShellArg cfg.logDirectory}
    ''
  );
in
{
  options.services.team-mokea = {
    enable = mkEnableOption "Team Mokea user proxy service";

    package = mkOption {
      type = types.package;
      default = defaultPackage;
      defaultText = literalExpression "pkgs.callPackage ./nix/package.nix { }";
      description = "Team Mokea package to run.";
    };

    installPackage = mkOption {
      type = types.bool;
      default = true;
      description = "Whether to add the Team Mokea CLI package to home.packages.";
    };

    configFile = mkOption {
      type = types.nullOr types.str;
      default = null;
      example = "~/.config/team-mokea.json";
      description = ''
        Mutable Team Mokea config path. When null, the module uses
        xdg.configHome/team-mokea.json.

        This should be writable by the user service because Team Mokea persists
        refreshed OAuth tokens, account changes, routes, quota settings, and
        runtime state next to the config.
      '';
    };

    configSource = mkOption {
      type = types.nullOr types.str;
      default = null;
      example = literalExpression "config.sops.secrets.team-mokea-config.path";
      description = ''
        Optional seed config copied to configFile only when configFile does not
        already exist. This is intended for sops-nix Home Manager integration or
        another user-readable secret provider.
      '';
    };

    stateDirectory = mkOption {
      type = types.nullOr types.str;
      default = null;
      example = "~/.local/state/team-mokea";
      description = ''
        Working directory created for the user service. When null, the module
        uses xdg.stateHome/team-mokea.
      '';
    };

    host = mkOption {
      type = types.nullOr types.str;
      default = null;
      example = "127.0.0.1";
      description = ''
        Optional bind host override passed through TEAM_MOKEA_HOST. Leave null
        to use Team Mokea's config/default behavior.
      '';
    };

    logDirectory = mkOption {
      type = types.nullOr types.str;
      default = null;
      example = "~/.local/state/team-mokea/logs";
      description = "Optional request/response log directory passed via --log-to.";
    };

    extraArgs = mkOption {
      type = types.listOf types.str;
      default = [ ];
      example = [ "--no-tui" ];
      description = "Extra command-line arguments appended to team-mokea server --headless.";
    };

    environment = mkOption {
      type = types.attrsOf types.str;
      default = { };
      example = {
        TEAM_MOKEA_UPSTREAM_HEADERS_TIMEOUT_MS = "120000";
      };
      description = "Extra environment variables for the Team Mokea user service.";
    };

    serviceConfig = mkOption {
      type = types.attrsOf types.anything;
      default = { };
      example = literalExpression ''
        {
          RestartSec = "10s";
        }
      '';
      description = "Extra systemd user service settings merged into Service.";
    };
  };

  config = mkIf cfg.enable {
    home.packages = mkIf cfg.installPackage [ cfg.package ];

    systemd.user.services.team-mokea = {
      Unit = {
        Description = "Team Mokea proxy";
      };

      Service = {
        Type = "simple";
        ExecStartPre = "${preStart}";
        ExecStart = "${lib.getExe cfg.package} ${lib.escapeShellArgs serverArgs}";
        Restart = "on-failure";
        RestartSec = "5s";
        WorkingDirectory = stateDirectory;
        Environment = [
          "TEAM_MOKEA_CONFIG=${configFile}"
          "TEAM_MOKEA_DISABLE_AUTOUPDATE=1"
        ]
        ++ lib.optionals (cfg.host != null) [
          "TEAM_MOKEA_HOST=${cfg.host}"
        ]
        ++ lib.mapAttrsToList (name: value: "${name}=${value}") cfg.environment;
      }
      // cfg.serviceConfig;

      Install = {
        WantedBy = [ "default.target" ];
      };
    };
  };
}
