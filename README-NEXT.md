# LedBox Next.js frontend

The public LedBox experience now lives in the Next.js App Router while preserving the existing dark/cyan visual system. The public catalog is static; lead persistence and admin authentication are intentionally separate backend work.

## Local checks

```bash
npm install
npm run typecheck
npm run build
```

Set `NEXT_PUBLIC_SITE_URL` and `NEXT_PUBLIC_WHATSAPP_NUMBER` only when needed. Real database, JWT, Resend, and deployment secrets belong in Owncoding Hub, never GitHub.
