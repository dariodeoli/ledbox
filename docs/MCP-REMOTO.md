# Servidor MCP remoto — primera etapa

`POST`, `GET` y `DELETE /mcp` implementan el transporte Streamable HTTP del SDK oficial `@modelcontextprotocol/sdk`. `GET /mcp/health` es una sonda pública de disponibilidad y solo informa servicio, protocolo, versión y estado de OAuth; no revela estado de base ni datos de empresa.

Cada request MCP exige una sesión de administrador existente o una API key bearer (`lbx_…`). La ruta delega en `requireAdminContext`, que vuelve a resolver empresa activa, membresía, bloqueo y rol en cada request. No se acepta `organizationId` de parámetros MCP. Las sesiones MCP solo guardan estado de protocolo. No hay herramientas de negocio habilitadas todavía; se registrarán modularmente después de definir capacidades por herramienta y pruebas de aislamiento.

OAuth 2.1/PKCE, autorización externa, registro dinámico y metadatos de protected resource no se anuncian ni simulan: el repositorio aún no tiene un proveedor OAuth ni una URL pública canónica con issuer. `lib/server/mcp/auth.ts` deja el límite de adaptación para incorporar un proveedor compatible más adelante. Mientras tanto, clientes MCP deben enviar una cookie de sesión válida o la API key acotada por rol que ya ofrece la aplicación. No guardar credenciales en el repositorio.

Verificación local: `GET /mcp/health`, inicialización MCP autenticada, listado vacío de herramientas, rechazo sin credenciales y errores de sesión inexistente. Esta etapa no requiere variables de entorno adicionales.
