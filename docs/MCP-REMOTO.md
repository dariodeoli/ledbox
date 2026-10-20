# Servidor MCP remoto — primera etapa

`POST`, `GET` y `DELETE /mcp` implementan Streamable HTTP con el SDK oficial. `GET /mcp/health` informa protocolo, versión y lecturas registradas sin revelar estado de base ni datos de empresa. Cada request exige sesión administrativa o API key `lbx_…`; autenticación, empresa activa, membresía, bloqueo y rol se vuelven a resolver por request. La sesión queda ligada al mismo actor. No se acepta `organizationId` desde argumentos.

Las lecturas habilitadas son perfil, catálogo comercial, disponibilidad, clientes, leads, presupuestos y eventos. Consultan solo la organización del contexto autenticado y aplican esquemas estrictos y allowlists de salida.

`prices.preview`/`prices.confirm` implementan cambio del precio comercial de `SalesProduct` por audiencia y umbral. El preview queda persistido una hora, ligado a actor y empresa, guarda el estado anterior y se invalida si el precio cambió. Confirmar exige `previewId` e `idempotencyKey`; escritura, recibo idempotente y auditoría se confirman en una transacción. No expone costos ni afecta precios de alquiler.

`quantities.preview`/`quantities.confirm` permiten aumentar el conteo físico de un ítem de inventario mediante el servicio existente de unidades. El preview también queda persistido y ligado a actor/empresa; la confirmación exige `previewId` e `idempotencyKey`, bloquea el inventario, valida que el conteo no haya cambiado y escribe unidades y auditoría en la transacción. Reducciones, combos y productos archivados quedan bloqueados; deben resolverse con el flujo operativo de retiros/estados.

Las mutaciones de precios de alquiler, perfil de empresa, fotos y borradores de presupuestos siguen respondiendo `PREVIEW_NOT_IMPLEMENTED`/`NOT_IMPLEMENTED`. Sus rutas existentes no ofrecen hoy un servicio reutilizable que mantenga preview persistente, idempotencia, aislamiento de actor/empresa y auditoría dentro de una sola transacción; fotos además requieren bytes, no solo metadatos/hash. No se simulan cambios. Toda mutación queda deshabilitada en empresas demo y sandbox.

OAuth 2.1/PKCE, autorización externa, registro dinámico y metadatos de protected resource no se anuncian ni simulan: falta provisionar un authorization server y dominio HTTPS canónico. Por ahora se usan cookie existente o API key acotada por rol.
