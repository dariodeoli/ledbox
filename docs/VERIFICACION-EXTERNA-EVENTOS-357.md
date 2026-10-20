# Verificación externa EventOS (#357)

**Corte de evidencia pública: 2026-10-20.** Esta verificación usa DNS público y
peticiones HTTPS anónimas. No lee variables de entorno ni credenciales, no inicia
un login OAuth, no envía correos y no modifica Google Cloud, Resend, Cloudflare
ni Coolify.

## Evidencia observada

| Área | Observación pública | Qué demuestra | Qué no demuestra |
| --- | --- | --- | --- |
| Delegación DNS `eventoss.online` | NS de Cloudflare (`ray` y `nucum`) | El dominio publica delegación a Cloudflare | Que la zona esté correctamente vinculada en Coolify o que todos los registros sean los deseados |
| Hosts `eventoss.online`, `app`, `clientes`, `demo`, `eventos`, `www` | A/AAAA resuelven a IPs de Cloudflare; HTTPS responde. El apex, portal, demo, `eventos` y `www` devolvieron 200; `app` en `/` devolvió 307 | DNS público y terminación HTTPS responden; el panel redirige | Estado interno del deploy, certificado/configuración de Coolify, disponibilidad de login o backend |
| Landing por host | La landing pública presenta marca EventOS, canonical `https://eventoss.online` y `/icon.svg` | La identidad pública del sitio matriz es EventOS | Propiedad o configuración de Google Search Console |
| Tienda `eventoss.online/tienda/ledboxxx` | Título y `og:site_name` son LedBox; canonical apunta a la tienda; favicon apunta al logo de LedBox | El HTML público de esa tienda usa identidad del tenant | Todas las tiendas/rutas, vista previa real en WhatsApp o recursos privados |
| Dominio del remitente `weem.com.py` | Hay MX y SPF en la raíz; `_dmarc` publica `p=none`; `resend._domainkey` tiene una clave TXT pública | Hay registros DNS publicados compatibles con correo y un selector DKIM con ese nombre | Que Resend marque el dominio como verificado, que el selector sea el esperado por la cuenta, alineación efectiva o entrega |
| Return-path `send.weem.com.py` | Hay MX y SPF publicados; el MX observado apunta a infraestructura Amazon SES | El subdominio tiene registros públicos para un flujo de retorno | Qué proveedor los usa o si Resend acepta su configuración |
| Google OAuth | Documentación en [SSO.md](SSO.md) especifica origen y callback del panel | La app documenta el origen `https://app.eventoss.online` y callback `/api/auth/callback/google` | Cliente, consentimiento, dominio autorizado, redirect URI, usuarios de prueba o estado de publicación en Google Cloud |

Los valores TXT de DKIM/SPF no se imprimen en el informe automatizado. `p=none`
es una política DMARC de monitorización, no de cuarentena/rechazo.

## Repetir la comprobación pública

```sh
npm run verify:eventos:external
```

El comando sólo hace consultas DNS y `HEAD https://<host>/` para los seis
hosts indicados. Muestra presencia y estados HTTP, nunca el contenido de TXT,
cookies, cabeceras de autorización o datos de respuesta. Un `WARN` de Resend o
Google es intencional: la confirmación final requiere acceso de solo lectura al
panel del proveedor; este comando no intenta inferirla.

## Verificaciones manuales para cerrar el issue

1. En Google Cloud Console, confirmar cliente web de EventOS, dominio
   `eventoss.online`, origen autorizado `https://app.eventoss.online`, callback
   exacto `https://app.eventoss.online/api/auth/callback/google`, scopes
   `openid email profile`, estado de publicación y usuario de prueba. Registrar
   sólo fecha, estado y nombres de configuración, nunca IDs privados ni secretos.
2. En Resend, confirmar que el dominio remitente requerido por
   `eventoss@weem.com.py` está **Verified** y que SPF, DKIM y return-path están
   validados. Confirmar el selector/nombre de host desde la cuenta en vez de
   asumir que el selector público `resend` basta. No copiar API keys.
3. En Coolify, comprobar que los seis hosts están asociados al recurso correcto,
   que el último despliegue está `finished` para el SHA servido y que los
   certificados están válidos. DNS/HTTPS público no acredita ese estado interno.
4. Hacer una prueba de login con una cuenta de prueba autorizada y una entrega
   de correo a un buzón controlado, sin datos comerciales. Registrar resultado,
   hora, SHA y ambiente; no adjuntar tokens, cookies ni el mensaje completo.
5. Para cada tienda, abrir la URL compartible y validar título, canonical,
   `og:site_name`, imagen social/foto de portada y favicon del tenant. La prueba
   automatizada observada para `ledboxxx` no sustituye a las otras empresas ni a
   la vista previa de WhatsApp.

Hasta recibir esas evidencias autenticadas, Google Cloud, Resend y el estado
interno de Coolify permanecen **pendientes de confirmación**, aunque los DNS
públicos respondan.
