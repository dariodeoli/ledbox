import { publicConfig } from "@/lib/public-config";
import { contrastRatio, normalizeHex, readableOn } from "@/lib/storefront-theme";
import { instagramHref, instagramLabel } from "@/lib/admin-format";
import { waMeLink } from "@/lib/whatsapp-link";
import { APP_VERSION_LABEL } from "@/lib/version";
import { MAIL_PALETTES, MAIL_THEME_CSS } from "./theme";

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
  /** Empresa que firma el correo (pie y texto plano). Si falta, rige `brand.name`; sin ninguna sale como EventOS. */
  organization?: string | null;
  /** Compact reason in the footer. */
  reason?: string | null;
  /**
   * Marca del remitente. Con `platform: true` el correo es de EventOS (alta de empresa, reset);
   * si no, es de una empresa: logo y nombre junto a la marca EventOS, contacto en el pie y su
   * color solo en botón y acentos (`color` ya viene validado con contraste AA contra blanco).
   */
  brand?: MailBrand | null;
};

/** Datos de contacto del perfil de la empresa; solo viaja lo que la empresa cargó. */
export type MailContact = {
  phone?: string | null;
  whatsapp?: string | null;
  instagram?: string | null;
  email?: string | null;
  website?: string | null;
  /** Dirección en una línea (calle, barrio, ciudad). */
  address?: string | null;
  /** Link de Google Maps de la dirección. */
  mapsUrl?: string | null;
};

export type MailBrand = {
  /** `true`: correo de la plataforma (marca EventOS, sin empresa). */
  platform?: boolean;
  /** Nombre de la empresa (encabezado, pie y texto alternativo del logo). */
  name?: string | null;
  /** Color de marca `#rrggbb` para el botón y los acentos. */
  color?: string | null;
  /** Logo público de la empresa (variante para fondo oscuro, que es el del encabezado). */
  logoUrl?: string | null;
  /** `true` si el logo es la variante para fondo claro: se apoya sobre una chapa blanca. */
  logoOnPlate?: boolean;
  /** Proporción del logo (ancho y alto en píxeles) para reservar el espacio en Outlook. */
  logoWidth?: number | null;
  logoHeight?: number | null;
  contact?: MailContact | null;
};

/** Marca de la plataforma: correos de EventOS (alta de empresa, reset de contraseña, alertas). */
export const PLATFORM_BRAND: MailBrand = { platform: true, name: "EventOS" };

const BRAND = MAIL_PALETTES.light;
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

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

function paragraphs(value: string | string[] | null | undefined, style: string, className: string): string {
  return listOf(value).map((text) => `<p class="${className}" style="${style}">${escapeHtml(text)}</p>`).join("");
}

/** Isotipo de EventOS en PNG (los clientes de correo no dibujan SVG); es un recurso público, no un secreto. */
export function mailLogoUrl(): string {
  return `${publicConfig.siteUrl}/assets/eventos-mark.png`;
}

const LINK_STYLE = `color:${BRAND.ink};text-decoration:underline;text-decoration-color:${BRAND.lineStrong};text-underline-offset:2px;`;

function link(href: string, label: string): string {
  return `<a class="lb-link" href="${escapeHtml(href)}" style="${LINK_STYLE}">${escapeHtml(label)}</a>`;
}

function rowsHtml(rows: MailRow[]): string {
  if (rows.length === 0) return "";
  const cells = rows
    .map((row, index) => {
      const value = escapeHtml(row.value);
      const content = row.href ? link(row.href, row.value) : value;
      const border = index === rows.length - 1 ? "" : `border-bottom:1px solid ${BRAND.line};`;
      return (
        `<tr>` +
        `<td class="lb-muted lb-row-label" style="width:38%;padding:12px 16px 12px 0;${border}color:${BRAND.muted};font-size:14px;line-height:1.5;vertical-align:top;overflow-wrap:anywhere;word-break:break-word;">${escapeHtml(row.label)}</td>` +
        `<td class="lb-ink lb-row-value" align="right" style="padding:12px 0;${border}color:${BRAND.ink};font-size:14px;font-weight:${row.strong ? "700" : "500"};line-height:1.5;vertical-align:top;overflow-wrap:anywhere;word-break:break-word;">${content}</td>` +
        `</tr>`
      );
    })
    .join("");
  return (
    `<table class="lb-summary" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;background:${BRAND.card};border-top:1px solid ${BRAND.line};border-bottom:1px solid ${BRAND.line};">` +
    `<tr><td colspan="2" style="padding:0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="table-layout:fixed;border-collapse:collapse;"><tr><td style="height:4px;line-height:4px;font-size:1px;" height="4"></td></tr></table></td></tr>` +
    `<tr><td colspan="2" style="padding:0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="table-layout:fixed;border-collapse:collapse;">${cells}</table></td></tr>` +
    `</table>`
  );
}

/** Color del botón: el de marca si da contraste AA con su texto y con blanco; si no, negro. */
function buttonColor(color: string | null): string | null {
  return color && contrastRatio(color, "#ffffff") >= 4.5 ? color : null;
}

function ctaHtml(cta: MailCta, brandColor: string | null): string {
  const url = escapeHtml(cta.url);
  const label = escapeHtml(cta.label);
  // Con color de marca el botón lo usa; esas clases no entran en las reglas del modo oscuro (el
  // botón conserva su par fondo/texto en cualquier cliente). Sin marca: negro con texto blanco.
  const bg = brandColor ?? BRAND.button;
  const ink = brandColor ? readableOn(brandColor) : BRAND.buttonInk;
  const surface = brandColor ? "lb-cta-brand" : "lb-cta-surface";
  const button = brandColor ? "lb-btn-brand" : "lb-btn";
  return (
    `<table class="lb-cta-table" role="presentation" cellpadding="0" cellspacing="0" border="0" style="max-width:100%;margin:28px 0 0;">` +
    `<tr><td class="${surface}" align="left" bgcolor="${bg}" style="border-radius:8px;">` +
    `<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${url}" style="height:46px;v-text-anchor:middle;width:260px;" arcsize="17%" fillcolor="${bg}" strokecolor="${bg}"><w:anchorlock/><v:textbox inset="8px,8px,8px,8px" style="mso-fit-shape-to-text:true;"><center style="color:${ink};font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;word-wrap:break-word;">${label}</center></v:textbox></v:roundrect><![endif]-->` +
    `<!--[if !mso]><!--><a class="${button}" href="${url}" style="display:inline-block;box-sizing:border-box;max-width:100%;min-height:44px;padding:13px 24px;border-radius:8px;background:${bg};color:${ink};font:600 14px ${FONT};line-height:1.4;text-decoration:none;overflow-wrap:anywhere;word-break:break-word;">${label}</a><!--<![endif]-->` +
    `</td></tr></table>` +
    `<p class="lb-soft" style="margin:14px 0 0;color:${BRAND.mutedSoft};font-size:12px;line-height:1.6;overflow-wrap:anywhere;word-break:break-word;">Si el botón no abre, copiá este enlace:<br>${link(cta.url, cta.url)}</p>` +
    (cta.note ? `<p class="lb-muted" style="margin:8px 0 0;color:${BRAND.muted};font-size:12px;line-height:1.6;">${escapeHtml(cta.note)}</p>` : "")
  );
}

function noteHtml(note: string | string[] | null | undefined): string {
  const body = paragraphs(note, `margin:0 0 6px;color:${BRAND.muted};font-size:13px;line-height:1.6;`, "lb-muted");
  if (!body) return "";
  return `<div class="lb-note" style="margin:28px 0 0;padding:14px 16px;border:1px solid ${BRAND.line};background:${BRAND.cardMuted};border-radius:8px;">${body}</div>`;
}

/** Estado: texto en mayúsculas con borde fino, siempre neutro (el color es solo del botón). */
function statusHtml(status: MailStatus | null | undefined): string {
  if (!status?.label.trim()) return "";
  const tone = status.tone ?? "neutral";
  return `<span class="lb-status-${tone}" style="display:inline-block;padding:4px 10px;border:1px solid ${BRAND.line};border-radius:999px;background:${BRAND.card};color:${BRAND.muted};font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;">${escapeHtml(status.label.trim())}</span>`;
}

type ContactItem = { label: string; href: string | null };

/** Medios de contacto de la empresa en el orden del pie; lo que no se cargó no aparece. */
function contactItems(contact: MailContact | null | undefined): { channels: ContactItem[]; address: ContactItem | null } {
  const c = contact ?? {};
  const channels: ContactItem[] = [];
  const phone = (c.phone ?? "").trim();
  if (phone) channels.push({ label: phone, href: `tel:${phone.replace(/[^\d+]/g, "")}` });
  const whatsapp = (c.whatsapp ?? "").trim();
  if (whatsapp && waMeLink(whatsapp)) channels.push({ label: `WhatsApp ${whatsapp}`, href: waMeLink(whatsapp) });
  const instagram = instagramLabel(c.instagram);
  if (instagram) channels.push({ label: instagram, href: instagramHref(c.instagram) });
  const email = (c.email ?? "").trim();
  if (email) channels.push({ label: email, href: `mailto:${email}` });
  const website = (c.website ?? "").trim();
  if (website) channels.push({ label: website.replace(/^https?:\/\//i, "").replace(/\/$/, ""), href: website });
  const address = (c.address ?? "").trim();
  return { channels, address: address ? { label: address, href: (c.mapsUrl ?? "").trim() || null } : null };
}

type Identity = { platform: boolean; name: string; brand: MailBrand | null };

function identityOf(input: MailContent): Identity {
  const brand = input.brand ?? null;
  const name = (brand?.name ?? "").trim() || (input.organization ?? "").trim();
  const platform = brand?.platform === true || !name;
  return { platform, name: platform ? "EventOS" : name, brand };
}

const FOOT_LINK = `color:${BRAND.muted};text-decoration:underline;text-decoration-color:${BRAND.lineStrong};text-underline-offset:2px;`;
const footLink = (href: string, label: string) => `<a class="lb-link lb-foot-link" href="${escapeHtml(href)}" style="${FOOT_LINK}">${escapeHtml(label)}</a>`;

function footerHtml(identity: Identity, reason: string | null | undefined): string {
  const note = (reason ?? "").trim();
  const row = (content: string) => `<p class="lb-muted" style="margin:4px 0 0;color:${BRAND.muted};font-size:12px;line-height:1.6;">${content}</p>`;
  let company = "";
  if (identity.platform) {
    const wa = waMeLink(publicConfig.whatsappNumber);
    company =
      `<p class="lb-muted" style="margin:0;color:${BRAND.muted};font-size:12px;font-weight:600;line-height:1.6;">EventOS · Gestión operativa para eventos</p>` +
      row([footLink(publicConfig.siteUrl, "Sitio web"), wa ? footLink(wa, "WhatsApp") : "", "Asunción, Paraguay"].filter(Boolean).join(" · "));
  } else {
    const { channels, address } = contactItems(identity.brand?.contact);
    company = `<p class="lb-muted" style="margin:0;color:${BRAND.muted};font-size:12px;font-weight:600;line-height:1.6;">${escapeHtml(identity.name)}</p>`;
    if (channels.length > 0) company += row(channels.map((item) => (item.href ? footLink(item.href, item.label) : escapeHtml(item.label))).join(" · "));
    if (address) company += row(address.href ? footLink(address.href, address.label) : escapeHtml(address.label));
  }
  return (
    `<tr><td class="lb-footer lb-pad" style="padding:0 40px 32px;background:${BRAND.card};border-radius:0 0 12px 12px;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-top:1px solid ${BRAND.line};height:20px;line-height:20px;font-size:1px;" height="20"></td></tr></table>` +
    company +
    `<p class="lb-muted" style="margin:12px 0 0;color:${BRAND.muted};font-size:12px;line-height:1.6;">Enviado con <strong>EventOS</strong> · ${escapeHtml(APP_VERSION_LABEL)}</p>` +
    (note ? `<p class="lb-soft" style="margin:6px 0 0;color:${BRAND.mutedSoft};font-size:12px;line-height:1.6;">Recibiste este correo porque ${escapeHtml(note)}.</p>` : "") +
    `</td></tr>`
  );
}

/** Encabezado mínimo: logo y nombre de la empresa a la izquierda, isotipo EventOS chico y gris a la derecha. */
function headerHtml(identity: Identity): string {
  const mark = (size: number) => `<img src="${escapeHtml(mailLogoUrl())}" width="${size}" height="${size}" alt="EventOS" style="display:block;width:${size}px;height:${size}px;border-radius:6px;opacity:.5;">`;
  const brand = identity.brand;
  let left: string;
  let right = `<td align="right" style="vertical-align:middle;">${mark(22)}</td>`;
  if (identity.platform) {
    left = `<td style="padding:0 10px 0 0;vertical-align:middle;">${mark(28)}</td><td class="lb-header-ink" style="vertical-align:middle;font:600 16px ${FONT};color:${BRAND.headerInk};">EventOS</td>`;
    right = "";
  } else {
    const name = escapeHtml(identity.name);
    const logo = brand?.logoUrl?.trim();
    const nameCell = `<td class="lb-header-ink" style="vertical-align:middle;font:600 16px ${FONT};color:${BRAND.headerInk};">${name}</td>`;
    if (logo) {
      const height = 30;
      const ratio = brand?.logoWidth && brand?.logoHeight ? brand.logoWidth / brand.logoHeight : null;
      const width = ratio ? Math.max(20, Math.min(140, Math.round(height * ratio))) : null;
      const size = width ? `width="${width}" height="${height}"` : `height="${height}"`;
      // Variante clara (pensada para fondo oscuro) sobre una chapa negra; la oscura va directo sobre el blanco.
      const plate = brand?.logoOnPlate ? `background:${BRAND.button};padding:4px 6px;border-radius:6px;` : "";
      left =
        `<td style="padding:0 10px 0 0;vertical-align:middle;"><img src="${escapeHtml(logo)}" ${size} alt="${name}" style="display:block;height:${height}px;max-width:140px;${width ? `width:${width}px;` : "width:auto;"}${plate}box-sizing:content-box;"></td>` +
        nameCell;
    } else {
      left = nameCell;
    }
  }
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>` +
    `<td align="left" style="vertical-align:middle;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>${left}</tr></table></td>` +
    right +
    `</tr></table>`
  );
}

/** Render the complete HTML email. */
export function renderMail(input: MailContent): string {
  const identity = identityOf(input);
  const title = escapeHtml(input.title);
  const eyebrowText = (input.eyebrow ?? "").trim();
  const preheader = escapeHtml((input.preheader ?? input.title ?? "").trim());
  const intro = paragraphs(input.intro, `margin:0 0 14px;color:${BRAND.body};font-size:15px;line-height:1.6;`, "lb-body");
  const brandColor = identity.platform ? null : buttonColor(normalizeHex(identity.brand?.color ?? null));
  const rows = rowsHtml(input.rows ?? []);
  const cta = input.cta ? ctaHtml(input.cta, brandColor) : "";
  const note = noteHtml(input.note);
  const status = statusHtml(input.status);

  return (
    `<!doctype html>` +
    `<html lang="es">` +
    `<head>` +
    `<meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="color-scheme" content="light dark">` +
    `<meta name="supported-color-schemes" content="light dark">` +
    `<meta name="format-detection" content="telephone=no">` +
    `<title>${title}</title>` +
    `<style>` +
    `body{margin:0;padding:0;background:${BRAND.canvas};}` +
    `a{text-decoration:none;}` +
    `.lb-card p,.lb-title,.lb-footer,.lb-note{overflow-wrap:anywhere;word-break:break-word;}` +
    MAIL_THEME_CSS +
    `@media (max-width:480px){` +
    `.lb-wrap{padding:12px 8px !important;}` +
    `.lb-card{width:100% !important;border-radius:12px !important;}` +
    `.lb-pad{padding-left:22px !important;padding-right:22px !important;}` +
    `.lb-header-pad{padding:20px 22px !important;}` +
    `.lb-title{font-size:20px !important;}` +
    `.lb-btn,.lb-btn-brand{display:block !important;text-align:center !important;padding:15px 18px !important;}` +
    `.lb-cta-table{width:100% !important;table-layout:fixed !important;}` +
    `}` +
    `</style>` +
    `</head>` +
    `<body class="lb-canvas" style="margin:0;padding:0;background:${BRAND.canvas};color:${BRAND.ink};font-family:${FONT};">` +
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${BRAND.canvas};font-size:1px;line-height:1px;">${preheader}</div>` +
    `<table class="lb-canvas" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.canvas};">` +
    `<tr><td align="center" class="lb-wrap" style="padding:32px 12px 40px;">` +
    `<table role="presentation" class="lb-card" width="580" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:580px;table-layout:fixed;background:${BRAND.card};border:1px solid ${BRAND.line};border-radius:12px;">` +
    `<tr><td class="lb-header lb-header-pad" style="padding:24px 40px 22px;background:${BRAND.card};border-bottom:1px solid ${BRAND.line};border-radius:12px 12px 0 0;">` +
    headerHtml(identity) +
    `</td></tr>` +
    `<tr><td class="lb-content lb-pad" style="padding:36px 40px 36px;background:${BRAND.card};color:${BRAND.ink};">` +
    (eyebrowText ? `<p class="lb-muted" style="margin:0 0 12px;color:${BRAND.muted};font-size:12px;font-weight:600;letter-spacing:.06em;line-height:1.3;text-transform:uppercase;">${escapeHtml(eyebrowText)}</p>` : "") +
    (status ? `<p style="margin:0 0 14px;">${status}</p>` : "") +
    `<h1 class="lb-title lb-ink" style="margin:0 0 16px;color:${BRAND.ink};font:600 22px ${FONT};line-height:1.3;letter-spacing:-.01em;">${title}</h1>` +
    intro +
    (rows ? `<div style="margin:24px 0 0;">${rows}</div>` : "") +
    cta +
    note +
    `</td></tr>` +
    footerHtml(identity, input.reason) +
    `</table>` +
    `</td></tr></table>` +
    `</body></html>`
  );
}

/** Plain-text alternative carrying the same information as the HTML version. */
export function renderMailText(input: MailContent): string {
  const identity = identityOf(input);
  const lines: string[] = [identity.platform ? "EventOS" : `${identity.name} · vía EventOS`, ""];
  if (input.eyebrow?.trim()) lines.push(input.eyebrow.trim());
  lines.push(input.title);
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
  if (identity.platform) {
    lines.push("EventOS · Gestión operativa para eventos");
    lines.push(`${publicConfig.siteUrl} · WhatsApp ${waMeLink(publicConfig.whatsappNumber) ?? ""} · Asunción, Paraguay`);
  } else {
    lines.push(identity.name);
    const { channels, address } = contactItems(identity.brand?.contact);
    if (channels.length > 0) lines.push(channels.map((item) => item.label).join(" · "));
    if (address) lines.push(address.href ? `${address.label} (${address.href})` : address.label);
  }
  lines.push(`Enviado con EventOS · ${APP_VERSION_LABEL}`);
  if (input.reason?.trim()) lines.push(`Recibiste este correo porque ${input.reason.trim()}.`);
  return lines.join("\n");
}

export { escapeHtml as escapeMailHtml };
