import { resolve4, resolve6, resolveCname, resolveMx, resolveNs, resolveTxt } from "node:dns/promises";
import { pathToFileURL } from "node:url";

const WEB_HOSTS = [
  "eventoss.online",
  "app.eventoss.online",
  "clientes.eventoss.online",
  "demo.eventoss.online",
  "eventos.eventoss.online",
  "www.eventoss.online",
] as const;
const SENDER_DOMAIN = "weem.com.py";

type Check = { name: string; status: "PASS" | "WARN" | "FAIL"; detail: string };

async function attempt<T>(run: () => Promise<T>): Promise<T | null> {
  try { return await run(); } catch { return null; }
}

/** Reports DNS presence only; never prints TXT values, credentials, or email content. */
export async function inspectPublicDns(domain = SENDER_DOMAIN): Promise<Check[]> {
  const [nameservers, mx, txt, dmarc, dkimTxt, dkimCname, returnMx, returnTxt] = await Promise.all([
    attempt(() => resolveNs(domain)),
    attempt(() => resolveMx(domain)),
    attempt(() => resolveTxt(domain)),
    attempt(() => resolveTxt(`_dmarc.${domain}`)),
    attempt(() => resolveTxt(`resend._domainkey.${domain}`)),
    attempt(() => resolveCname(`resend._domainkey.${domain}`)),
    attempt(() => resolveMx(`send.${domain}`)),
    attempt(() => resolveTxt(`send.${domain}`)),
  ]);
  return summarizeDnsEvidence(domain, {
    nameservers: nameservers ?? [], mx: mx ?? [], txt: (txt ?? []).map((parts) => parts.join("")),
    dmarcTxt: (dmarc ?? []).map((parts) => parts.join("")), dkimPresent: Boolean(dkimTxt?.length || dkimCname?.length),
    returnMx: returnMx ?? [], returnTxt: (returnTxt ?? []).map((parts) => parts.join("")),
  });
}

export function summarizeDnsEvidence(domain: string, evidence: {
  nameservers: string[]; mx: unknown[]; txt: string[]; dmarcTxt: string[]; dkimPresent: boolean; returnMx?: unknown[]; returnTxt?: string[];
}): Check[] {
  const hasSpf = evidence.txt.some((value) => /^v=spf1\b/i.test(value.trim()));
  const dmarc = evidence.dmarcTxt.find((value) => value.toLowerCase().startsWith("v=dmarc1;"));
  const policy = dmarc?.match(/(?:^|;)\s*p\s*=\s*([a-z]+)/i)?.[1]?.toLowerCase();
  const returnSpf = (evidence.returnTxt ?? []).some((value) => /^v=spf1\b/i.test(value.trim()));
  return [
    { name: `DNS NS ${domain}`, status: evidence.nameservers.length ? "PASS" : "FAIL", detail: evidence.nameservers.some((ns) => ns.endsWith(".ns.cloudflare.com")) ? "Nameservers publicados; incluye Cloudflare" : evidence.nameservers.length ? "Nameservers publicados" : "No se resolvieron nameservers" },
    { name: `DNS MX ${domain}`, status: evidence.mx.length ? "PASS" : "WARN", detail: evidence.mx.length ? `${evidence.mx.length} registro(s) MX publicados` : "No se resolvieron registros MX" },
    { name: `DNS SPF ${domain}`, status: hasSpf ? "PASS" : "WARN", detail: hasSpf ? "Registro SPF publicado" : "No se encontró SPF en el dominio raíz" },
    { name: `DNS DMARC ${domain}`, status: dmarc ? "PASS" : "WARN", detail: dmarc ? `Registro publicado; política p=${policy ?? "sin especificar"}` : "No se encontró registro DMARC" },
    { name: `DNS DKIM resend._domainkey.${domain}`, status: evidence.dkimPresent ? "PASS" : "WARN", detail: evidence.dkimPresent ? "Selector resend publicado (valor omitido)" : "No se encontró este selector DKIM; verificar el selector exacto indicado por el proveedor" },
    { name: `DNS MX send.${domain}`, status: evidence.returnMx?.length ? "PASS" : "WARN", detail: evidence.returnMx?.length ? `${evidence.returnMx.length} registro(s) MX publicados` : "No se resolvieron registros MX del return-path" },
    { name: `DNS SPF send.${domain}`, status: returnSpf ? "PASS" : "WARN", detail: returnSpf ? "Registro SPF publicado" : "No se encontró SPF en el return-path" },
  ];
}

export async function inspectPublicHosts(hosts: readonly string[] = WEB_HOSTS): Promise<Check[]> {
  return Promise.all(hosts.map(async (host) => {
    const [ipv4, ipv6, response] = await Promise.all([
      attempt(() => resolve4(host)),
      attempt(() => resolve6(host)),
      attempt(() => fetch(`https://${host}/`, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(12_000) })),
    ]);
    const resolved = Boolean(ipv4?.length || ipv6?.length);
    const httpsOkay = Boolean(response && response.status >= 200 && response.status < 400);
    const status = resolved && httpsOkay ? "PASS" : "FAIL";
    return {
      name: `HTTPS ${host}`,
      status,
      detail: `DNS ${resolved ? "resuelve" : "sin respuesta"}; HTTPS ${response ? response.status : "sin respuesta/TLS"}`,
    };
  }));
}

export async function runExternalChecks(): Promise<Check[]> {
  return [...await inspectPublicHosts(), ...await inspectPublicDns()];
}

async function main(): Promise<void> {
  const checks = await runExternalChecks();
  for (const check of checks) console.log(`${check.status}\t${check.name}\t${check.detail}`);
  const failures = checks.filter((check) => check.status === "FAIL");
  console.log(`\nGoogle Cloud OAuth: WARN\tNo se verifica públicamente el estado del cliente, consentimiento ni callback registrado.`);
  console.log(`Resend: WARN\tDNS público no acredita dominio validado en Resend ni entrega de correo.`);
  console.log(`Resultado: ${failures.length ? `${failures.length} fallo(s)` : "sin fallos de DNS/HTTPS público"}; no se consultaron secretos ni se enviaron correos.`);
  if (failures.length) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
