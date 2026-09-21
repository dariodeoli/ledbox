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

Cuatro superficies sobre la misma app, separadas por host:

| Superficie | Producción | Rutas |
| --- | --- | --- |
| Sitio público | `ledbox.online` | `/` (catálogo, carrito, leads) |
| Panel privado | `admin.ledbox.online` | `/login`, `/dashboard`, `/eventos`, `/finanzas`… sin prefijo `/admin` |
| Portal del cliente | `clientes.ledbox.online` | `/` (validador) y `/p/<código>` (presupuesto) |
| Demo pública | `demo.ledbox.online` | `/` (demo con datos simulados, solo lectura) |

Las páginas del panel son rutas raíz reales en `app/(admin)/*` (el route group no cambia la URL), el sitio público en `app/(public)/*` y el portal en `app/(portal)/*`. En el host admin, `/` muestra el dashboard; en el del cliente, el validador; en el de la demo, la demo. En el host público, `middleware.ts` redirige las rutas del panel al subdominio usando `lib/admin-routes.ts`, y `/demo` al host de la demo. Los dominios se definen en `lib/public-config.ts` (`NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_ADMIN_URL`, `NEXT_PUBLIC_CLIENT_URL`, `NEXT_PUBLIC_DEMO_URL`) y los usa también el middleware (fuente única).

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
| `npm run test:rules` | Reglas puras de campos (`node --test` + `tsx`) y chequeo de fuente del kit |
| `npm run check:fields` | Falla si quedan inputs sueltos o `type="number"` en el panel |
| `npm run release:prepare` | Validación previa a publicar: typecheck + tests + build |
| `npm run prisma:migrate` / `prisma:deploy` | Migraciones en desarrollo / producción |
| `npm run prisma:seed` | Crea los admins iniciales (allowlist) |

## Versión, prepare y publish

- La versión vive en `package.json` y no se duplica: `lib/version.ts` la expone como `APP_VERSION` y el pie del panel la muestra (`v<versión>`).
- **Prepare (valida, no publica):** `npm run release:prepare` corre `typecheck` + `test:rules` (reglas puras y chequeo de fuente de campos) + `build`. Es el paso obligatorio antes de declarar una versión lista.
- **Publish (publica):** el deploy lo hace Owncoding Hub/Coolify desde la rama viva; no hay script de publicación local. Al informar un deploy, decir la versión publicada y el estado real de cada frente, sin presentar local como publicado.
- El flujo es simple a propósito: no hay release automatizado; la fuente única evita que la versión visible quede atrás de la publicada.

## Migraciones en el deploy

`npm run build` y `npm start` ejecutan `scripts/migrate-deploy.mjs`, que aplica las migraciones pendientes antes de que el servidor atienda tráfico (en el build es best-effort; sin `DATABASE_URL` se omite). Si la base publicada se creó con `prisma db push` y no tiene historial de migraciones, el script marca la init como aplicada y después aplica las pendientes. Si las migraciones fallan al arrancar, el servidor no inicia (mejor que servir con el schema viejo).

## Documentación

- [README-NEXT.md](README-NEXT.md) — migración del frontend a Next.js.
- [docs/CONTEXTO-LEDBOX.md](docs/CONTEXTO-LEDBOX.md) — contexto general: qué existe hoy, arquitectura y pendientes.
- [docs/REGLAS-GENERALES.md](docs/REGLAS-GENERALES.md) — reglas generales de la app (obligatorias).
- [AGENTS.md](AGENTS.md) — reglas para agentes que trabajan en el repo.
