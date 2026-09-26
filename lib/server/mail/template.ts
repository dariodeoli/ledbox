import { publicConfig } from "@/lib/public-config";

/**
 * Shared transactional email system for LedBox/EventOS.
 *
 * The renderer deliberately uses tables, inline critical styles, a plain-text
 * alternative, and a small responsive stylesheet so the same content holds up
 * in Gmail, Outlook, and mobile clients. Interpolated content is escaped before
 * it reaches HTML; callers keep ownership of the data contract.
 */

/** Data row shown in the summary card. */
export type MailRow = {
  label: string;
  value: string;
  /** If provided, the value is rendered as a link. */
  href?: string;
  /** Emphasized values such as totals or access codes. */
  strong?: boolean;
};

export type MailCta = {
  label: string;
  url: string;
  /** Short supporting text below the button. */
  note?: string;
};

export type MailStatusTone = "accent" | "success" | "warning" | "neutral";

export type MailStatus = {
  label: string;
  tone?: MailStatusTone;
};

export type MailContent = {
  /** Visible subject/title and document title. */
  title: string;
  /** One or more introductory paragraphs. */
  intro?: string | string[] | null;
  /** Primary action and fallback link. */
  cta?: MailCta | null;
  /** Summary data: amounts, dates, codes, and items. */
  rows?: MailRow[] | null;
  /** Supporting notes below the main content. */
  note?: string | string[] | null;
  /** Inbox preheader text. */
  preheader?: string | null;
  /** Small eyebrow above the title. Defaults to the product name. */
  eyebrow?: string | null;
  /** Optional status chip for messages that need a clear state. */
  status?: MailStatus | null;
  /** Organization displayed in the footer; defaults to LedBox. */
  organization?: string | null;
  /** Compact reason in the footer. */
  reason?: string | null;
};

const BRAND = {
  canvas: "#f3efe9",
  card: "#fffdfa",
  cardMuted: "#f8f5f0",
  graphite: "#20282b",
  ink: "#1f292c",
  muted: "#637177",
  mutedSoft: "#859196",
  line: "#e5e0d9",
  accent: "#08b7cf",
  accentSoft: "#e6f8fb",
  accentInk: "#063943",
  success: "#16805d",
  successSoft: "#e8f6ef",
  warning: "#9a6411",
  warningSoft: "#fff4dc",
} as const;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function listOf(value: string | string[] | null | undefined): string[] {
  return (Array.isArray(value) ? value : value ? [value] : []).map((text) => text.trim()).filter(Boolean);
}

function paragraphs(value: string | string[] | null | undefined, style: string): string {
  return listOf(value).map((text) => `<p style="${style}">${escapeHtml(text)}</p>`).join("");
}

/** Public logo URL; the logo remains a normal hosted asset, never a secret. */
export function mailLogoUrl(): string {
  return `${publicConfig.siteUrl}/assets/icon-192.png`;
}

function rowsHtml(rows: MailRow[]): string {
  if (rows.length === 0) return "";
  const cells = rows
    .map((row) => {
      const value = escapeHtml(row.value);
      const content = row.href
        ? `<a href="${escapeHtml(row.href)}" style="color:${BRAND.accentInk};text-decoration:underline;text-underline-offset:2px;">${value}</a>`
        : value;
      const weight = row.strong ? "700" : "600";
      return (
        `<tr>` +
        `<td style="padding:11px 14px 11px 0;border-bottom:1px solid ${BRAND.line};color:${BRAND.muted};font-size:13px;line-height:1.45;vertical-align:top;">${escapeHtml(row.label)}</td>` +
        `<td align="right" style="padding:11px 0;border-bottom:1px solid ${BRAND.line};color:${BRAND.ink};font-size:13px;font-weight:${weight};line-height:1.45;vertical-align:top;word-break:break-word;">${content}</td>` +
        `</tr>`
      );
    })
    .join("");
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;border-spacing:0;background:${BRAND.cardMuted};border:1px solid ${BRAND.line};border-radius:12px;overflow:hidden;">` +
    `<tr><td colspan="2" style="padding:14px 16px 2px;color:${BRAND.ink};font-size:11px;font-weight:800;letter-spacing:.13em;text-transform:uppercase;">Resumen</td></tr>` +
    `<tr><td colspan="2" style="padding:0 16px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">${cells}</table></td></tr>` +
    `</table>`
  );
}

function ctaHtml(cta: MailCta): string {
  const url = escapeHtml(cta.url);
  const label = escapeHtml(cta.label);
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0 0;">` +
    `<tr><td align="left" bgcolor="${BRAND.accent}" style="border-radius:7px;">` +
    `<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="${url}" style="height:46px;v-text-anchor:middle;width:260px;" arcsize="15%" fillcolor="${BRAND.accent}" strokecolor="${BRAND.accent}"><w:anchorlock/><center style="color:${BRAND.accentInk};font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;">${label}</center></v:roundrect><![endif]-->` +
    `<!--[if !mso]><!--><a class="lb-btn" href="${url}" style="display:inline-block;padding:14px 22px;border-radius:7px;background:${BRAND.accent};color:${BRAND.accentInk};font:700 14px Arial,Helvetica,sans-serif;text-decoration:none;letter-spacing:.01em;">${label}</a><!--<![endif]-->` +
    `</td></tr></table>` +
    `<p style="margin:10px 0 0;color:${BRAND.mutedSoft};font-size:12px;line-height:1.5;word-break:break-word;">Si el botón no abre, copiá este enlace:<br><a href="${url}" style="color:${BRAND.accentInk};text-decoration:underline;text-underline-offset:2px;">${url}</a></p>` +
    (cta.note ? `<p style="margin:7px 0 0;color:${BRAND.muted};font-size:12px;line-height:1.5;">${escapeHtml(cta.note)}</p>` : "")
  );
}

function noteHtml(note: string | string[] | null | undefined): string {
  const body = paragraphs(note, `margin:0 0 5px;color:${BRAND.muted};font-size:12.5px;line-height:1.55;`);
  if (!body) return "";
  return `<div style="margin:18px 0 0;padding:12px 14px;border-left:3px solid ${BRAND.accent};background:${BRAND.accentSoft};border-radius:0 8px 8px 0;">${body}</div>`;
}

function statusHtml(status: MailStatus | null | undefined): string {
  if (!status?.label.trim()) return "";
  const tone = status.tone ?? "accent";
  const colors = {
    accent: { background: BRAND.accentSoft, color: BRAND.accentInk },
    success: { background: BRAND.successSoft, color: BRAND.success },
    warning: { background: BRAND.warningSoft, color: BRAND.warning },
    neutral: { background: BRAND.cardMuted, color: BRAND.muted },
  }[tone];
  return `<span style="display:inline-block;padding:6px 9px;border-radius:999px;background:${colors.background};color:${colors.color};font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;">${escapeHtml(status.label.trim())}</span>`;
}

function footerHtml(input: { organization?: string | null; reason?: string | null }): string {
  const organization = (input.organization ?? "").trim() || "LedBox";
  const reason = (input.reason ?? "").trim();
  const site = escapeHtml(publicConfig.siteUrl);
  const whatsapp = `https://wa.me/${escapeHtml(publicConfig.whatsappNumber)}`;
  return (
    `<tr><td style="padding:20px 28px 24px;border-top:1px solid ${BRAND.line};background:${BRAND.cardMuted};border-radius:0 0 14px 14px;">` +
    `<p style="margin:0;color:${BRAND.ink};font-size:13px;font-weight:800;">${escapeHtml(organization)}</p>` +
    `<p style="margin:5px 0 0;color:${BRAND.muted};font-size:11.5px;line-height:1.55;">EventOS · Gestión operativa para eventos</p>` +
    (reason ? `<p style="margin:9px 0 0;color:${BRAND.mutedSoft};font-size:11.5px;line-height:1.55;">Recibiste este correo porque ${escapeHtml(reason)}.</p>` : "") +
    `<p style="margin:10px 0 0;color:${BRAND.muted};font-size:12px;line-height:1.6;">` +
    `<a href="${site}" style="color:${BRAND.accentInk};text-decoration:underline;text-underline-offset:2px;">Sitio web</a>` +
    ` · <a href="${whatsapp}" style="color:${BRAND.accentInk};text-decoration:underline;text-underline-offset:2px;">Contactar por WhatsApp</a>` +
    ` · Asunción, Paraguay</p>` +
    `</td></tr>`
  );
}

/** Render the complete HTML email. */
export function renderMail(input: MailContent): string {
  const title = escapeHtml(input.title);
  const eyebrow = escapeHtml((input.eyebrow ?? "LedBox · EventOS").trim());
  const preheader = escapeHtml((input.preheader ?? input.title ?? "").trim());
  const intro = paragraphs(input.intro, `margin:0 0 13px;color:${BRAND.ink};font-size:14.5px;line-height:1.68;`);
  const rows = rowsHtml(input.rows ?? []);
  const cta = input.cta ? ctaHtml(input.cta) : "";
  const note = noteHtml(input.note);
  const status = statusHtml(input.status);

  return (
    `<!doctype html>` +
    `<html lang="es">` +
    `<head>` +
    `<meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="color-scheme" content="light">` +
    `<meta name="supported-color-schemes" content="light">` +
    `<meta name="format-detection" content="telephone=no">` +
    `<title>${title}</title>` +
    `<style>` +
    `body{margin:0;padding:0;background:${BRAND.canvas};}` +
    `a{text-decoration:none;}` +
    `@media (max-width:480px){` +
    `.lb-wrap{padding:12px 8px !important;}` +
    `.lb-card{width:100% !important;border-radius:12px !important;}` +
    `.lb-pad{padding-left:18px !important;padding-right:18px !important;}` +
    `.lb-header-pad{padding:19px 18px !important;}` +
    `.lb-title{font-size:21px !important;}` +
    `.lb-btn{display:block !important;text-align:center !important;padding:15px 18px !important;}` +
    `}` +
    `</style>` +
    `</head>` +
    `<body>` +
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${BRAND.canvas};font-size:1px;line-height:1px;">${preheader}</div>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.canvas};">` +
    `<tr><td align="center" class="lb-wrap" style="padding:28px 12px 34px;">` +
    `<table role="presentation" class="lb-card" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:${BRAND.card};border:1px solid ${BRAND.line};border-radius:14px;">` +
    `<tr><td class="lb-header-pad" style="padding:22px 28px;background:${BRAND.graphite};border-radius:13px 13px 0 0;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>` +
    `<td align="left" style="vertical-align:middle;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>` +
    `<td style="padding:0 11px 0 0;"><img src="${escapeHtml(mailLogoUrl())}" width="38" height="38" alt="LedBox EventOS" style="display:block;width:38px;height:38px;border-radius:8px;"></td>` +
    `<td style="font:800 16px Arial,Helvetica,sans-serif;letter-spacing:2px;color:#ffffff;">LEDBOX<span style="color:${BRAND.accent};">.</span></td>` +
    `</tr></table></td>` +
    `<td align="right" style="vertical-align:middle;color:#b8c4c7;font:600 11px Arial,Helvetica,sans-serif;letter-spacing:.08em;text-transform:uppercase;">EventOS</td>` +
    `</tr></table>` +
    `</td></tr>` +
    `<tr><td class="lb-pad" style="padding:30px 28px 28px;">` +
    `<p style="margin:0 0 13px;color:${BRAND.muted};font-size:11px;font-weight:800;letter-spacing:.14em;line-height:1.3;text-transform:uppercase;">${eyebrow}</p>` +
    (status ? `<p style="margin:0 0 13px;">${status}</p>` : "") +
    `<h1 class="lb-title" style="margin:0 0 15px;color:${BRAND.ink};font:700 24px Arial,Helvetica,sans-serif;line-height:1.22;letter-spacing:-.01em;">${title}</h1>` +
    intro +
    (rows ? `<div style="margin:22px 0 0;">${rows}</div>` : "") +
    cta +
    note +
    `</td></tr>` +
    footerHtml({ organization: input.organization, reason: input.reason }) +
    `</table>` +
    `</td></tr></table>` +
    `</body></html>`
  );
}

/** Plain-text alternative carrying the same information as the HTML version. */
export function renderMailText(input: MailContent): string {
  const lines: string[] = [input.title];
  if (input.eyebrow?.trim()) lines.unshift(input.eyebrow.trim());
  if (input.status?.label.trim()) lines.push("", input.status.label.trim());
  const intro = listOf(input.intro);
  if (intro.length > 0) lines.push("", ...intro);
  const rows = input.rows ?? [];
  if (rows.length > 0) {
    lines.push("", "Resumen");
    for (const row of rows) lines.push(`${row.label}: ${row.value}${row.href ? ` (${row.href})` : ""}`);
  }
  if (input.cta) {
    lines.push("", `${input.cta.label}: ${input.cta.url}`);
    if (input.cta.note) lines.push(input.cta.note);
  }
  for (const text of listOf(input.note)) lines.push("", text);
  lines.push("", "--");
  lines.push((input.organization ?? "").trim() || "LedBox");
  lines.push("EventOS · Gestión operativa para eventos");
  if (input.reason?.trim()) lines.push(`Recibiste este correo porque ${input.reason.trim()}.`);
  lines.push(`${publicConfig.siteUrl} · WhatsApp https://wa.me/${publicConfig.whatsappNumber} · Asunción, Paraguay`);
  return lines.join("\n");
}

export { escapeHtml as escapeMailHtml };
