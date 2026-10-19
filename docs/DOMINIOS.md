# Dominios públicos y EventOS

Los hosts se configuran con variables públicas de URL; los valores de este
repositorio siguen usando LedBox como sitio principal y conservan la landing
actual de EventOS. La configuración de producción se cambia por ambiente, sin
modificar DNS ni nombres de servidor desde la aplicación.

`siteProfileForHost` reconoce `eventoss.online` (doble s), además de los
dominios EventOS existentes. `NEXT_PUBLIC_EVENTOS_DOMAINS` acepta una lista
separada por comas de dominios raíz; cada entrada reconoce el dominio exacto y
sus subdominios. Los hosts configurados para app, portal y demo mantienen sus
perfiles propios.

Para asignar los dominios de EventOS en un ambiente, configurar los hosts
realmente vinculados en Coolify/DNS. Por ejemplo:

```dotenv
NEXT_PUBLIC_ADMIN_URL=https://app.eventoss.online
NEXT_PUBLIC_APP_URL=https://app.eventoss.online
NEXT_PUBLIC_PRODUCT_URL=https://eventoss.online
NEXT_PUBLIC_EVENTOS_URL=https://eventoss.online
NEXT_PUBLIC_EVENTOS_DOMAINS=eventoss.online,eventos.ledbox.online,eventos.com.py
```

`NEXT_PUBLIC_ADMIN_URL` alimenta los enlaces absolutos del panel y su host
canónico; `NEXT_PUBLIC_APP_URL` identifica el perfil no indexable de la app;
`NEXT_PUBLIC_PRODUCT_URL` define el host canónico de la landing; y
`NEXT_PUBLIC_EVENTOS_URL` configura el perfil EventOS. Mantener
`ledbox.online` como `NEXT_PUBLIC_SITE_URL` preserva su landing y tienda.

Las URLs de Google SSO y otros callbacks deben apuntar al host del panel activo
en ese ambiente. Esta configuración prepara el enrutamiento y el SEO por host;
no acredita que los DNS, certificados o dominios estén activos.
