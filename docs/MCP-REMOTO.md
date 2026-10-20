# Servidor MCP remoto — primera etapa

`POST`, `GET` y `DELETE /mcp` implementan el transporte Streamable HTTP del SDK oficial `@modelcontextprotocol/sdk`. `GET /mcp/health` es una sonda pública de disponibilidad; informa el protocolo, versión y cantidad de herramientas de lectura registradas, sin revelar estado de base ni datos de empresa.

Cada request MCP exige una sesión de administrador existente o una API key bearer (`lbx_…`). La ruta delega en `requireAdminContext`, que vuelve a resolver empresa activa, membresía, bloqueo y rol en cada request. La sesión MCP queda ligada al mismo actor autenticado; el contexto de organización y rol se refresca para cada petición. No se acepta `organizationId` de parámetros MCP.

El catálogo define herramientas `*.read` para perfil de empresa, catálogo comercial, disponibilidad, clientes, leads, presupuestos y eventos. Cada consulta filtra por la organización del contexto de confianza, valida argumentos con esquema estricto y limita campos de salida; el catálogo comercial excluye costos, márgenes y proveedores. El rol se revisa en cada dispatch. Las herramientas de preview y confirmación están enumeradas para fijar su contrato y matriz de permisos, pero responden `NOT_IMPLEMENTED`/`PREVIEW_NOT_IMPLEMENTED` hasta que exista un servicio de negocio reusable. No simulan ni ejecutan mutaciones.

OAuth 2.1/PKCE, autorización externa, registro dinámico y metadatos de protected resource no se anuncian ni simulan: el repositorio aún no tiene un proveedor OAuth ni una URL pública canónica con issuer. `lib/server/mcp/auth.ts` deja el límite de adaptación para incorporar un proveedor compatible más adelante. Mientras tanto, clientes MCP deben enviar una cookie de sesión válida o la API key acotada por rol que ya ofrece la aplicación. No guardar credenciales en el repositorio.

Verificación local: `GET /mcp/health`, inicialización MCP autenticada, ping, autenticación en requests posteriores, dispatch con contexto tenant, rechazo de `organizationId` suministrado por el cliente, control por rol, errores sin detalles internos y confirmación explícitamente deshabilitada. No requiere variables de entorno adicionales ni migraciones.
