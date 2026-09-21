# LedBox

Sitio comercial y panel de gestión de LedBox: alquiler de pantallas y equipos LED, stands, activaciones y producción para eventos.

- **Sitio público:** [ledbox.online](https://ledbox.online)
- **Panel privado:** [admin.ledbox.online](https://admin.ledbox.online/login) — las rutas del panel no llevan `/admin`.
- **Instagram:** [@ledboxpy](https://www.instagram.com/ledboxpy)

## Stack

- Next.js 15 (App Router) + React 19 + TypeScript
- PostgreSQL + Prisma (migraciones versionadas en `prisma/migrations`)
- Autenticación propia con JWT en cookie HTTP-only (`jose`) + Google SSO
- Resend para recuperación de contraseña
- Deploy en Coolify / Owncoding Hub; DNS y proxy en Cloudflare

## URLs y entornos

Dos superficies sobre la misma app, separadas por host:

| Superficie | Producción | Rutas |
| --- | --- | --- |
| Sitio público | `ledbox.online` | `/` (catálogo, carrito, leads) |
| Panel privado | `admin.ledbox.online` | `/login`, `/dashboard`, `/eventos`, `/finanzas`… sin prefijo `/admin` |

Las páginas del panel son rutas raíz reales en `app/(admin)/*` (el route group no cambia la URL) y el sitio público en `app/(public)/*`. En el host admin, `/` muestra el dashboard; en el host público, `middleware.ts` redirige las rutas del panel al subdominio usando `lib/admin-routes.ts`.

En desarrollo, `npm run dev` deja el panel en `http://localhost:3000/dashboard` y el sitio en `http://localhost:3000`; no hace falta configurar hosts.

## Estructura

| Ruta | Qué contiene |
| --- | --- |
| `app/page.tsx` | Sitio público: catálogo, carrito, WhatsApp y captura de leads |
| `app/admin/` | Panel privado: login, recuperación de contraseña y dashboard |
| `app/api/` | Endpoints: `leads`, `quotes`, `auth/*`, `admin/*`, `health` |
| `components/` | Catálogo, carrito, captura de leads y componentes del panel |
| `lib/` | Catálogo público, configuración y helpers; `lib/server/*` (auth, db, rate-limit, resend, validación) |
| `prisma/` | Schema, migraciones y seed |

## Puesta en marcha

Requisitos: Node.js >= 20.9 y PostgreSQL.

```bash
npm install
cp .env.example .env.local   # completar DATABASE_URL, AUTH_SECRET, RESEND_API_KEY…
npm run prisma:generate
npm run prisma:migrate
npm run prisma:seed
npm run dev
```

Variables de entorno (los valores reales viven en Owncoding Hub, nunca en GitHub):

| Variable | Uso |
| --- | --- |
| `DATABASE_URL` | Conexión a PostgreSQL |
| `AUTH_SECRET` | Firma de las sesiones JWT |
| `APP_URL` / `NEXT_PUBLIC_SITE_URL` | Origen público de la app |
| `RESEND_API_KEY` / `EMAIL_FROM` | Envío de recuperación de contraseña |
| `NEXT_PUBLIC_WHATSAPP_NUMBER` | Número de WhatsApp del sitio |
| `LEDBOX_ADMIN_DARIO_PASSWORD` / `LEDBOX_ADMIN_SANTIAGO_PASSWORD` | Contraseñas (12+ caracteres) de los admins del seed |

## Scripts

| Script | Qué hace |
| --- | --- |
| `npm run dev` | Servidor de desarrollo |
| `npm run build` | `prisma generate`, build standalone y copia de `public` y `.next/static` |
| `npm start` | Arranca el server standalone |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run prisma:migrate` / `prisma:deploy` | Migraciones en desarrollo / producción |
| `npm run prisma:seed` | Crea los admins iniciales (allowlist) |

## Documentación

- [README-NEXT.md](README-NEXT.md) — migración del frontend a Next.js.
- [docs/CONTEXTO-LEDBOX.md](docs/CONTEXTO-LEDBOX.md) — contexto general: qué existe hoy, arquitectura y pendientes.
- [AGENTS.md](AGENTS.md) — reglas para agentes que trabajan en el repo.
