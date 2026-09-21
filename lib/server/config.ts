const ALLOWED_ADMIN_EMAILS = new Set([
  "dariodeoli@gmail.com",
  "santiago.rodas.sjr@gmail.com",
]);

export const authConfig = {
  sessionCookieName: "ledbox_session",
  sessionDurationMs: 1000 * 60 * 60 * 24 * 7,
  passwordResetDurationMs: 1000 * 60 * 30,
  resetSender: "LedBox <ledbox@weem.com.py>",
};

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isAllowedAdminEmail(email: string): boolean {
  return ALLOWED_ADMIN_EMAILS.has(normalizeEmail(email));
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}
