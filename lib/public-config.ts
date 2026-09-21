const DEFAULT_SITE_URL = "https://ledbox.online";
const DEFAULT_ADMIN_URL = "https://admin.ledbox.online";
const DEFAULT_WHATSAPP_NUMBER = "595982029217";

export const publicConfig = {
  siteUrl: (process.env.NEXT_PUBLIC_SITE_URL || DEFAULT_SITE_URL).replace(/\/$/, ""),
  adminUrl: (process.env.NEXT_PUBLIC_ADMIN_URL || DEFAULT_ADMIN_URL).replace(/\/$/, ""),
  whatsappNumber: process.env.NEXT_PUBLIC_WHATSAPP_NUMBER || DEFAULT_WHATSAPP_NUMBER,
} as const;

export function whatsappUrl(message: string): string {
  return `https://wa.me/${publicConfig.whatsappNumber}?text=${encodeURIComponent(message)}`;
}
