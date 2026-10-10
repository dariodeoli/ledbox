# #156 · Landing comercial y pie institucional

Entrega **local**, separada de #173. Base autorizada: `ef43c7c57460b8faeecd682e7d33b6c4dd0a825a`; rama `feat/156-eventos-landing` en `carril-panel`. La rama `slot/panel` conserva su historia y punta `db331e76381a9e4b66f533cb2d3dc40c5d4d11de`.

## Landing

- Muestra comercial semántica y responsive: propuesta → aprobación → operación → cobro. Evento ficticio declarado explícitamente, sin datos de clientes ni métricas inventadas.
- Beneficios y capacidades del producto, CTA de demo de solo lectura y contacto. Enlace a LedBox usa `publicConfig.siteUrl` para evitar volver a la misma landing del host EventOS.
- Canonical, OpenGraph y Twitter del producto; schema `SoftwareApplication`/FAQ con capacidades y editor real, sin oferta gratuita inventada. Sin imagen pesada en el primer render de la muestra.
- Sitemap sin anclas. `clientes` y `demo`, como el panel, no son indexables. Icono SVG y favicons existentes conservados.

## Pie único

`app/layout.tsx` elige la superficie por host y ruta y emite **un** `AppFooter` fuera de los layouts de contenido. `AppFooter` compone **ProductFooter publicado de owncoding-ui**, cuyo contrato acepta marca, versión, año, crédito, enlaces y contenido adicional. No se crea otro helper de footer.

Fuente única `APP_VERSION_LABEL`, año UTC actual, derechos y crédito exacto **Desarrollado en Paraguay por OwnCoding**. `PublicFooter` agrega navegación comercial como contenido del mismo ProductFooter; no duplica copyright. Se retiraron los usos por página/layout y el wrapper `<footer>` de AdminShell.

La navegación institucional neutraliza el posicionamiento global de `nav`; crédito dentro de su footer, sin overlay. Tema claro/oscuro y padding móvil para no quedar detrás de la navegación inferior del panel. El error de aplicación y el error global ofrecen reintento; el error global sustituye el layout raíz con el mismo componente, sin duplicarlo.

## Inventario de cobertura

| Superficie | Rutas / estados | Composición |
| --- | --- | --- |
| LedBox | `/`, `/productos/[slug]`, `/privacidad`, 404 | PublicFooter → AppFooter → ProductFooter, layout raíz |
| EventOS | `/` → `/producto`, privacidad, términos, status, 404 | AppFooter product, layout raíz |
| Panel | dashboard y todos los módulos de `app/(admin)/(panel)`, estados de sesión/carga/error, offline | AppFooter app, layout raíz |
| Auth | login, recuperar, reset-password, invitación | AppFooter app, layout raíz; AdminFrame no añade otro |
| Demo | raíz → demo y 404 | AppFooter app, layout raíz |
| Portal | raíz → portal, presupuesto tokenizado, firma y auditoría, comparación, 404 tokenizado | AppFooter portal, layout raíz; PortalLayout no añade otro |
| Imprimibles | presupuesto, evento, factura y reporte | AppFooter app fuera del documento, visible al imprimir. PrintFooter interno conserva nota/referencia, no es otro pie global |
| Firma inmutable | SignatureDocumentSheet y flujo firmado | Pie global sólo fuera del artículo; se conserva oculto en impresión de hoja firmada. No cambia snapshot, payload, HTML serializado, bytes PDF ni hash; no re-sello |
| Errores raíz | `app/error.tsx`, `app/global-error.tsx`, not-found | Root footer en error/404; global-error sustituye root con ProductFooter único |

Las rutas heredadas que redirigen no tienen DOM propio. Los endpoints API/robots/sitemap y archivos estáticos no son páginas HTML con footer. Los estados de carga existentes de los módulos/panel conservan el pie raíz; no se añade suspense raíz que convierta el 404 tokenizado en HTTP 200.

Inventario completo de archivos de página y rutas en la evidencia externa `evidencia/156/route-inventory.json`. Cobertura estructural de todas las rutas por composición raíz; QA dinámica representativa por los cinco hosts en `browser.json`. No se presenta la cobertura estructural como una visita autenticada a cada documento individual.

## Verificación y límites

Checks: typecheck, rules, build y browser de aplicación real sobre Postgres **local aislado 55561**, runtime **3061**, proxy GET/HEAD **3062** que conserva el Host real de cada superficie. Fixtures completamente sintéticos; sesión privada fuera de evidencia. Host routing, SEO, iconos, navegación, cantidad de pies/copyright/versión, límites 360/390/1440, tema claro/oscuro, crédito sin superposición, 404, portal, panel y presupuesto imprimible.

QA independiente de Pilot #156 se agenda **después del cierre servido de #173**. Esta entrega no certifica publicación ni modifica HD, triggers, watchers o comandos de despliegue. Artefacto 3047 y PG55473 de #173 intactos. No push, merge a viva ni despliegue.
