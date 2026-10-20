/** Reject external, protocol-relative and malformed redirect targets. */
export function safeLocalReturnTo(value: unknown): string | null {
  if (typeof value !== "string" || value.length < 1 || value.length > 2048 || !value.startsWith("/") || value.startsWith("//") || value.includes("\\") || /[\u0000-\u001f]/.test(value)) return null;
  try {
    const url = new URL(value, "https://local.invalid");
    if (url.origin !== "https://local.invalid") return null;
    return `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}
