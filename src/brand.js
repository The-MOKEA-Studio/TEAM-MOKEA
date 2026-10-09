// The current name is Team Mokea. Keep reading the previous project's
// environment variables, routes, and config path so existing installs migrate
// without losing their settings.

/** Current CLI, package, config basename, and route prefix. */
export const NAME = 'team-mokea';
/** Previous name, retained for migration from existing installations. */
export const LEGACY_NAME = 'teamclaude';

/** Prefix of the environment variables, new spelling first. */
export const ENV_PREFIX = 'TEAM_MOKEA_';
export const LEGACY_ENV_PREFIX = 'TEAMCLAUDE_';

/** Prefix of the control routes (`/team-mokea/status`, …). */
export const ROUTE_PREFIX = `/${NAME}`;
export const LEGACY_ROUTE_PREFIX = `/${LEGACY_NAME}`;

/**
 * Read one of the proxy's own environment variables by its unprefixed name:
 * `envVar('CONFIG')` is `TEAM_MOKEA_CONFIG`, or `TEAMCLAUDE_CONFIG` when only
 * that one is set. A variable that is set wins over one that is not, even
 * when set to the empty string, so a shell that exports `TEAM_MOKEA_HOST=`
 * to unset an inherited `TEAMCLAUDE_HOST` gets what it asked for; callers
 * that treat the empty string as "not given" (`|| default`) still do.
 *
 * @param {string} name  the part after the prefix, e.g. 'CONFIG'
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string|undefined}
 */
export function envVar(name, env = process.env) {
  const renamed = env[ENV_PREFIX + name];
  return renamed !== undefined ? renamed : env[LEGACY_ENV_PREFIX + name];
}

/**
 * Rewrite a previous-name control route to the current prefix. This keeps
 * existing clients working while the handlers use only the Team Mokea paths.
 *
 * @param {string|undefined} url
 * @returns {string|null}
 */
export function legacyControlUrl(url) {
  if (!url || !url.startsWith(LEGACY_ROUTE_PREFIX)) return null;
  const rest = url.slice(LEGACY_ROUTE_PREFIX.length);
  if (rest !== '' && rest[0] !== '/' && rest[0] !== '?') return null;
  return ROUTE_PREFIX + rest;
}
