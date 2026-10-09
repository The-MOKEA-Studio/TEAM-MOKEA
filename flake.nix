{
  description = "Team Mokea packaged as a dependency-free Node application";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { self, nixpkgs }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];
      forAllSystems =
        f:
        builtins.listToAttrs (
          map (system: {
            name = system;
            value = f system;
          }) systems
        );
    in
    {
      packages = forAllSystems (
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
          team-mokea = pkgs.callPackage ./nix/package.nix { };
        in
        {
          inherit team-mokea;
          default = team-mokea;
        }
      );

      checks = forAllSystems (
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
        in
        {
          # `nix flake check` builds the package on every system.
          package = self.packages.${system}.team-mokea;
        }
        # The NixOS VM test only runs on Linux (nixosTest requires a Linux host).
        // nixpkgs.lib.optionalAttrs pkgs.stdenv.hostPlatform.isLinux {
          nixos-module = import ./nix/tests/module.nix { inherit pkgs self system; };
        }
      );

      apps = forAllSystems (system: {
        team-mokea = {
          type = "app";
          program = "${self.packages.${system}.team-mokea}/bin/team-mokea";
          meta = {
            inherit (self.packages.${system}.team-mokea.meta) description;
          };
        };
        default = self.apps.${system}.team-mokea;
      });

      nixosModules = {
        team-mokea = import ./nix/module.nix;
        default = self.nixosModules.team-mokea;
      };

      homeManagerModules = {
        team-mokea = import ./nix/home-manager-module.nix;
        default = self.homeManagerModules.team-mokea;
      };
    };
}
