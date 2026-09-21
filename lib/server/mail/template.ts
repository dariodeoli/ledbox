import { publicConfig } from "@/lib/public-config";

/**
 * Plantilla única de correo de LedBox: **una sola base para todos los correos**
 * (reset de contraseña, recordatorios de cobro, presupuesto e invitaciones).
 *
 * - Identidad LedBox: fondo negro, tarjeta oscura, cyan eléctrico en el botón y
 *   el logo de la marca (`public/assets/icon-192.png`, servido por el sitio).
 * - HTML de correo real: tablas, estilos embebidos y una hoja `<style>` con
 *   media queries para mobile. Sin dependencias ni recursos externos salvo el
 *   logo público.
 * - El motivo del correo viaja en el pie ("Recibiste este correo porque…"), los
 *   datos de la empresa en el pie y el contenido puntual en `rows`.
 * - Todo valor interpolado se escapa: el contenido puede traer textos del
 *   cliente (títulos de presupuesto, notas) y nunca se inyecta HTML.
 *
 * Contrato: `renderMail({ title, intro, cta, rows, note })` devuelve el HTML
 * completo; `renderMailText` la alternativa en texto plano (misma información).
 */

/** Fila del bloque de datos: `label` a la izquierda, `value` a la derecha. */
export type MailRow = {
  label: string;
  value: string;
  /** Si viene, el valor se dibuja como link (por ejemplo el código o la hoja). */
  href?: string;
  /** Valor destacado (totales, códigos). */
  strong?: boolean;
};

export type MailCta = {
  label: string;
  url: string;
  /** Aclaración corta debajo del botón (opcional). */
  note?: string;
};

export type MailContent = {
  /** Motivo del correo; es el título visible y el `<title>` del documento. */
  title: string;
  /** Uno o más párrafos de introducción. */
  intro?: string | string[] | null;
  /** Botón principal (con su link de respaldo en texto). */
  cta?: MailCta | null;
  /** Datos en tabla: montos, vencimientos, códigos, ítems. */
  rows?: MailRow[] | null;
  /** Aclaraciones al pie del bloque principal. */
  note?: string | string[] | null;
  /** Texto del preheader (lo que muestra la bandeja junto al asunto). */
  preheader?: string | null;
  /** Nombre de la empresa en el pie; sin él va «LedBox». */
  organization?: string | null;
  /** Motivo en el pie: «Recibiste este correo porque {reason}.» */
  reason?: string | null;
};

const BRAND = {
  black: "#050505",
  panel: "#0b0f12",
  panel2: "#080c0f",
  line: "#1c242a",
  text: "#f2f6f8",
  muted: "#9aa9b3",
  muted2: "#7d8d97",
  accent: "#00e5ff",
  accentInk: "#04191d",
  ok: "#3ddc97",
} as const;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function paragraphs(value: string | string[] | null | undefined, style: string): string {
  const list = (Array.isArray(value) ? value : value ? [value] : []).map((text) => text.trim()).filter(Boolean);
  return list.map((text) => `<p style="${style}">${escapeHtml(text)}</p>`).join("");
}

/** Logo del correo: el ícono público de LedBox (nunca un binario de la base). */
export function mailLogoUrl(): string {
  return `${publicConfig.siteUrl}/assets/icon-192.png`;
}

function rowsHtml(rows: MailRow[]): string {
  if (rows.length === 0) return "";
  const cells = rows
    .map((row) => {
      const value = escapeHtml(row.value);
      const content = row.href
        ? `<a href="${escapeHtml(row.href)}" style="color:${BRAND.accent};text-decoration:none;">${value}</a>`
        : value;
      const weight = row.strong ? "700" : "600";
      return (
        `<tr>` +
        `<td style="padding:7px 12px 7px 0;border-bottom:1px solid ${BRAND.line};color:${BRAND.muted};font-size:13px;line-height:1.4;vertical-align:top;">${escapeHtml(row.label)}</td>` +
        `<td align="right" style="padding:7px 0;border-bottom:1px solid ${BRAND.line};color:${BRAND.text};font-size:13px;font-weight:${weight};line-height:1.4;white-space:nowrap;">${content}</td>` +
        `</tr>`
      );
    })
    .join("");
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:4px 0 2px;">` +
    cells +
    `</table>`
  );
}

function ctaHtml(cta: MailCta): string {
  const url = escapeHtml(cta.url);
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0 0;">` +
    `<tr><td align="center" bgcolor="${BRAND.accent}" style="border-radius:9px;">` +
    `<a class="lb-btn" href="${url}" style="display:inline-block;padding:13px 24px;border-radius:9px;background:${BRAND.accent};color:${BRAND.accentInk};font:700 15px Arial,Helvetica,sans-serif;text-decoration:none;letter-spacing:.01em;">${escapeHtml(cta.label)}</a>` +
    `</td></tr></table>` +
    `<p style="margin:9px 0 0;color:${BRAND.muted2};font-size:12px;line-height:1.5;word-break:break-all;">O copiá este link: <a href="${url}" style="color:${BRAND.accent};text-decoration:none;">${url}</a></p>` +
    (cta.note ? `<p style="margin:6px 0 0;color:${BRAND.muted2};font-size:12px;line-height:1.5;">${escapeHtml(cta.note)}</p>` : "")
  );
}

function noteHtml(note: string | string[] | null | undefined): string {
  const body = paragraphs(note, `margin:0 0 6px;color:${BRAND.muted};font-size:12.5px;line-height:1.6;`);
  if (!body) return "";
  return `<div style="margin:16px 0 0;padding:10px 12px;border-left:3px solid ${BRAND.accent};border-radius:0 8px 8px 0;background:${BRAND.panel2};">${body}</div>`;
}

function footerHtml(input: { organization?: string | null; reason?: string | null }): string {
  const organization = (input.organization ?? "").trim() || "LedBox";
  const reason = (input.reason ?? "").trim();
  const site = escapeHtml(publicConfig.siteUrl);
  const whatsapp = `https://wa.me/${escapeHtml(publicConfig.whatsappNumber)}`;
  return (
    `<tr><td style="padding:16px 26px 20px;border-top:1px solid ${BRAND.line};background:${BRAND.panel2};border-radius:0 0 14px 14px;">` +
    `<p style="margin:0;color:${BRAND.text};font-size:13px;font-weight:700;">${escapeHtml(organization)}</p>` +
    (reason ? `<p style="margin:5px 0 0;color:${BRAND.muted2};font-size:11.5px;line-height:1.55;">Recibiste este correo porque ${escapeHtml(reason)}.</p>` : "") +
    `<p style="margin:7px 0 0;color:${BRAND.muted};font-size:12px;line-height:1.6;">` +
    `<a href="${site}" style="color:${BRAND.accent};text-decoration:none;">${site.replace(/^https?:\/\//, "")}</a>` +
    ` · <a href="${whatsapp}" style="color:${BRAND.accent};text-decoration:none;">WhatsApp</a>` +
    ` · Asunción, Paraguay</p>` +
    `</td></tr>`
  );
}

/** HTML completo del correo (una sola plantilla para toda la app). */
export function renderMail(input: MailContent): string {
  const title = escapeHtml(input.title);
  const preheader = escapeHtml((input.preheader ?? input.title ?? "").trim());
  const intro = paragraphs(input.intro, `margin:0 0 12px;color:${BRAND.text};font-size:14.5px;line-height:1.65;`);
  const rows = rowsHtml(input.rows ?? []);
  const cta = input.cta ? ctaHtml(input.cta) : "";
  const note = noteHtml(input.note);

  return (
    `<!doctype html>` +
    `<html lang="es">` +
    `<head>` +
    `<meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="color-scheme" content="dark light">` +
    `<meta name="format-detection" content="telephone=no">` +
    `<title>${title}</title>` +
    `<style>` +
    `body{margin:0;padding:0;background:${BRAND.black};}` +
    `a{text-decoration:none;}` +
    `@media (max-width:480px){` +
    `.lb-wrap{padding:14px 8px !important;}` +
    `.lb-card{width:100% !important;border-radius:12px !important;}` +
    `.lb-pad{padding-left:16px !important;padding-right:16px !important;}` +
    `.lb-title{font-size:19px !important;}` +
    `.lb-btn{display:block !important;padding:15px 18px !important;}` +
    `}` +
    `</style>` +
    `</head>` +
    `<body>` +
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${BRAND.black};font-size:1px;">${preheader}</div>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.black};">` +
    `<tr><td align="center" class="lb-wrap" style="padding:26px 12px 30px;">` +
    `<table role="presentation" class="lb-card" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:${BRAND.panel};border:1px solid ${BRAND.line};border-radius:14px;">` +
    // Encabezado: logo + wordmark
    `<tr><td class="lb-pad" style="padding:22px 26px 0;">` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>` +
    `<td style="padding:0 10px 0 0;"><img src="${escapeHtml(mailLogoUrl())}" width="40" height="40" alt="LedBox" style="display:block;width:40px;height:40px;border-radius:9px;"></td>` +
    `<td style="font:800 17px Arial,Helvetica,sans-serif;letter-spacing:2.4px;color:${BRAND.text};">LEDBOX<span style="color:${BRAND.accent};">.</span></td>` +
    `</tr></table>` +
    `</td></tr>` +
    // Cuerpo
    `<tr><td class="lb-pad" style="padding:14px 26px 24px;">` +
    `<h1 class="lb-title" style="margin:6px 0 12px;color:${BRAND.text};font:700 21px Arial,Helvetica,sans-serif;line-height:1.25;">${title}</h1>` +
    intro +
    rows +
    cta +
    note +
    `</td></tr>` +
    footerHtml({ organization: input.organization, reason: input.reason }) +
    `</table>` +
    `</td></tr></table>` +
    `</body></html>`
  );
}

/** Alternativa en texto plano del mismo correo (mejor entrega en spam). */
export function renderMailText(input: MailContent): string {
  const lines: string[] = [input.title];
  const intro = (Array.isArray(input.intro) ? input.intro : input.intro ? [input.intro] : []).map((text) => text.trim()).filter(Boolean);
  if (intro.length > 0) lines.push("", ...intro);
  const rows = input.rows ?? [];
  if (rows.length > 0) {
    lines.push("");
    for (const row of rows) lines.push(`${row.label}: ${row.value}${row.href ? ` (${row.href})` : ""}`);
  }
  if (input.cta) {
    lines.push("", `${input.cta.label}: ${input.cta.url}`);
    if (input.cta.note) lines.push(input.cta.note);
  }
  for (const text of (Array.isArray(input.note) ? input.note : input.note ? [input.note] : []).map((value) => value.trim()).filter(Boolean)) {
    lines.push("", text);
  }
  lines.push("", "--");
  lines.push((input.organization ?? "").trim() || "LedBox");
  if (input.reason?.trim()) lines.push(`Recibiste este correo porque ${input.reason.trim()}.`);
  lines.push(`${publicConfig.siteUrl} · WhatsApp https://wa.me/${publicConfig.whatsappNumber} · Asunción, Paraguay`);
  return lines.join("\n");
}

export { escapeHtml as escapeMailHtml };
