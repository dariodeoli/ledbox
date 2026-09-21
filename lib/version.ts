import packageJson from "../package.json";

/**
 * Fuente única de la versión visible del panel: la de `package.json`.
 * Se muestra en el pie del panel; el flujo de `prepare` (validación) y
 * `publish` (deploy en Owncoding) está documentado en el README.
 */
export const APP_VERSION: string = packageJson.version;
export const APP_VERSION_LABEL = `v${APP_VERSION}`;
