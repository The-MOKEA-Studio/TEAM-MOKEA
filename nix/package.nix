{
  lib,
  stdenvNoCC,
  nodejs_24,
  makeWrapper,
}:

let
  packageJson = lib.importJSON ../package.json;
in
stdenvNoCC.mkDerivation {
  pname = "team-mokea";
  version = packageJson.version;

  src = lib.cleanSource ../.;

  nativeBuildInputs = [ makeWrapper ];

  dontBuild = true;

  installPhase = ''
    runHook preInstall

    mkdir -p $out/bin $out/share/team-mokea
    cp -R package.json src LICENSE README.md config.example.json $out/share/team-mokea/
    chmod +x $out/share/team-mokea/src/index.js

    makeWrapper ${lib.getExe nodejs_24} $out/bin/team-mokea \
      --add-flags "$out/share/team-mokea/src/index.js" \
      --set-default TEAM_MOKEA_DISABLE_AUTOUPDATE 1

    runHook postInstall
  '';

  meta = {
    description = packageJson.description;
    homepage = packageJson.homepage;
    license = lib.licenses.mit;
    mainProgram = "team-mokea";
    platforms = nodejs_24.meta.platforms;
  };
}
