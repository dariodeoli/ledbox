/**
 * DNT, entorno y flag de pruebas locales. Sin imports: lo usa el componente cliente
 * `PageBeacon` y las pruebas.
 */
export function shouldSendMetrics(input: {
  doNotTrack: string | null | undefined;
  nodeEnv: string | undefined;
  debugFlag?: string | undefined;
}): boolean {
  if (input.doNotTrack === "1") return false;
  return input.nodeEnv === "production" || input.debugFlag === "1";
}
