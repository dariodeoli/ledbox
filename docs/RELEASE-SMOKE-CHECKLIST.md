# Release checklist: build, runtime identity y flujos esenciales

Runbook reproducible para un release de LedBox/EventOS. Separa evidencia de CI, despliegue terminal, lecturas públicas y pruebas que mutan datos. No usar datos reales de clientes ni enviar mensajes, registrar pagos o cambiar stock para hacer QA.

## 1. Identificar exactamente el candidato

Antes de aprobar una integración, registrar:

- PR y rama de destino.
- SHA completo de `HEAD` (40 caracteres) y versión de `package.json`.
- URL del workflow CI que corre sobre ese mismo SHA.
- Lista de archivos funcionales incluidos y migraciones, si corresponde.

```bash
git status --short
git rev-parse HEAD
node -p 'require("./package.json").version'
gh pr view <PR> --json url,headRefOid,baseRefName,state
gh pr checks <PR>
```

El árbol debe estar limpio. No aceptar como CI del candidato un run de otro SHA, otro PR o una rama distinta. El workflow requerido (`.github/workflows/ci.yml`) debe terminar con todos sus pasos verdes: `npm ci`, Prisma generate, typecheck, `test:rules`, `check:contexto` y build. En checkout limpio se puede repetir localmente:

```bash
npm ci
npx prisma generate
npm run typecheck
npm run test:rules
npm run check:contexto
npm run build
```

Si una prueba está marcada `SKIP`, consignar ese número; no presentarla como aprobada. `npm run e2e` es un smoke informativo existente, no reemplaza el CI ni prueba por sí solo cada transacción listada abajo.

## 2. Integrar y comprobar despliegue terminal

La integración y publicación siguen el proceso del repositorio (`npm run ht` / `npm run hd`) y corresponden al integrador autorizado. No desplegar desde esta checklist ni disparar un deploy paralelo. Una integración, push o build exitoso no significa que el servicio ya esté publicado.

Cuando el Hub marque el deployment del SHA candidato como `FINISHED`, obtener evidencia terminal:

```bash
npm run deploy:verificar -- <VERSION> <SHA_COMPLETO_40>
```

El comando es una sonda GET: consulta el estado del deployment y lee `/api/health` más la superficie básica de cada host configurado en `scripts/verify-release.mjs`. Debe reportar `ok: true`, `status: FINISHED`, `database: ok`, migraciones enteras y coincidencia exacta de versión y SHA en **todos** los hosts. Un health HTTP 200 aislado no basta: el endpoint puede devolver HTTP 200 aunque la base figure `unavailable` o el SHA sea `null`.

También puede ejecutarse el humo de superficies del navegador contra una base elegida:

```bash
E2E_BASE_URL=<URL_BASE> E2E_CHROME_PATH=<RUTA_CHROME> npm run e2e
```

El script existente incluye `/api/health`, acceso `/login`, superficies SEO, demo y portal de presupuesto; no crea un lead ni emite/envía un presupuesto. Revisar el código de `scripts/e2e-smoke.mjs` antes de ampliar el alcance. Usar Chrome instalado; el script no descarga navegador.

## 3. Smoke público de solo lectura

Ejecutar en cada tienda o dominio que forma parte del release. Usar URLs públicas conocidas y no seguir enlaces que puedan aceptar, enviar, crear o pagar algo.

| Flujo | Comprobación | Evidencia esperada |
|---|---|---|
| Acceso | Abrir `/login` en el host de administración; verificar que carga y no muestra error de aplicación. No iniciar sesión con credenciales reales durante QA compartido. | URL, status, SHA/version observados; captura sin datos personales. |
| Tienda | Abrir `/tienda/<slug>`; comprobar que responde, presenta identidad de esa empresa y lista sólo su catálogo visible. Abrir una categoría y un producto. | URL y status; slug de prueba o empresa autorizada; sin errores de consola. |
| Filtros | Buscar un producto y seleccionar una categoría disponible. Navegar atrás/adelante si se incluye en el cambio. | Categoría/filtros esperados, scroll y estado de carga; sin errores. |
| Carrito local | Añadir un producto al carrito del navegador, comprobar el contador y la vista previa, recargar y verificar persistencia/aislamiento por tienda. | Nombre de tienda, cantidad, total referencial y resultado tras recarga. No continuar a enviar pedido/solicitud. |
| Lead | No crear leads en producción como parte del smoke de solo lectura. Validar el formulario visualmente y revisar el API contract en CI; la creación se prueba en el paso 4 con dato sintético. | Captura del formulario, sin enviar; prueba de API vinculada al CI. |
| Presupuesto | Abrir sólo un enlace autorizado de prueba. Verificar datos visibles y que no aparezcan costos internos. No aprobar, firmar, enviar, pagar ni cambiar estado. | URL/token oculto, status y captura redactada. |
| Comparación A/B/C | Abrir sólo enlace de prueba autorizado; confirmar que aparecen las alternativas, marca correcta, selector legible en mobile y que cambiar la opción no registra aprobación. No confirmar la elección en producción. | Capturas de desktop y mobile, cantidad de opciones, selección local sin mutación. |

En responsive, verificar al menos 390 px de ancho y escritorio. Si el release modifica layout móvil, sumar 320/360 px y tablet. Anotar overflow horizontal, encabezados superpuestos, controles inaccesibles y errores de consola. Este smoke no sustituye pruebas de accesibilidad.

## 4. Pruebas de escritura: exclusivamente entorno aislado y datos sintéticos

Las pruebas siguientes mutan datos. Ejecutarlas en CI/local con PostgreSQL aislado o en un tenant de QA expresamente preparado, nunca en la empresa operativa. Usar identificadores únicos con prefijo `QA-<run>-`, emails `example.invalid` y contactos ficticios. Desactivar transportes de correo/pagos; no copiar presupuestos ni tokens reales.

1. **Login:** con usuario de QA, verificar acceso correcto, salida y rechazo de una contraseña incorrecta; comprobar que la sesión queda en la empresa QA esperada.
2. **Tienda y carrito:** añadir/retirar líneas y persistir el carrito sólo en tenant de QA. Abrir la URL con otro tenant y comprobar que el carrito no se mezcla. Confirmar que el importe se recalcula desde el servidor al guardar; no crear una preorden real.
3. **Lead:** crear uno con consentimiento sintético desde el formulario de QA; encontrarlo en el CRM del tenant QA y confirmar que un usuario de otro tenant no puede leerlo. Verificar deduplicación/reintento según pruebas existentes. No enviar correo/WhatsApp.
4. **Presupuesto:** generar un borrador de QA desde ese lead o cliente sintético; comprobar tenant, detalle, importes y que crear el borrador no envía correo ni registra pago/reserva.
5. **Comparación:** agregar 2–5 presupuestos sintéticos del mismo cliente/empresa; verificar etiquetas, selección persistida al recargar, que seleccionar no aprueba por sí solo, que sólo la confirmación explícita aprueba una alternativa y que la restante queda sin aprobar. Probar token inválido y acceso cruzado entre empresas (debe fallar sin revelar datos). Revisar que costos internos no aparecen en la respuesta pública.

Los tests de navegador/API con PostgreSQL para una transacción real deben usar base temporal desechable, aplicar migraciones y limpiarse al terminar. Documentar comando, exit code y cantidad de pruebas; evitar capturar valores de sesión, emails reales o enlaces con token.

## 5. Paquete de evidencia de cierre

Guardar en el PR/issue (sin secretos ni datos de clientes):

```text
PR / issue:
SHA candidato (40 caracteres):
Versión:
CI: URL del run, SHA verificado, resultado de cada job:
Deployment: UUID/URL del Hub, estado terminal, SHA:
Health por host: URL del host, HTTP, status, database, migrations, version, SHA
Smoke público: fecha/hora UTC, URLs no secretas, resultado por fila, viewport(s)
Pruebas sintéticas: entorno/tenant QA, comandos, exit codes, tests pass/skip/fail
Pendientes/incidentes y responsable:
```

Redactar cualquier token de presupuesto/comparación, cookie, correo o teléfono antes de adjuntar capturas o logs. Si falta cualquiera de CI, estado `FINISHED`, coincidencia de SHA/versión o una superficie esperada, informar `PENDIENTE` y no declarar release verificado.

## Cobertura actual del smoke automatizado

`npm run e2e` cubre login visual, demo, decisiones del portal demo, SEO y health; no comprueba aún el carrito de tienda, la creación de leads sintéticos ni la comparación A/B/C en un único recorrido. Esos flujos están cubiertos por pruebas de módulo/integración existentes; para un smoke transaccional de navegador, primero hay que ejecutarlo contra fixture/tenant de QA con transporte de mensajes apagado. No reutilizar datos de producción para “completar” esas pruebas.
