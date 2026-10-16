# Respaldo portable de catálogo e inventario — formato v1 (#246)

En Estado → Sistema, OWNER/ADMIN puede descargar el ZIP. No es un respaldo completo de empresa ni sustituye el dump operativo descrito en OPERACION.md.

Incluye productos/códigos, unidades (incluidas retiradas), estado y conocimiento del conteo, propiedad/tercero separado de proveedor de compra, depósitos/ubicaciones, categorías, familias/variantes, componentes de combos, precios final/mayorista/tramos, fotos principales y galería, colecciones y relaciones. Conserva metadatos por unidad y bytes exactos almacenados; no recomprime. Los campos permitidos de v1 están congelados en lib/inventory-backup-fields.ts: un campo futuro no se exporta automáticamente.

Excluye empresa/configuración comercial, usuarios/credenciales/tokens, clientes, eventos/presupuestos/reservas, caja/facturas/pagos, firmas, incidentes e historial. Conserva los estados actuales y retenciones cuantitativas de inventario de forma conservadora; no reconstruye los incidentes que los originaron. Las URLs externas se conservan como referencia, sin descargar sus bytes ni garantizar su permanencia.

Límites reales: ZIP20MiB, contenido descomprimido20MiB, imágenes almacenadas15MiB (cada copia restaurada cuenta aunque se deduplique el ZIP),10.000 filas entre todas las entidades y2.000 entradas ZIP. Exceso produce error, no copia truncada. Nombres inseguros, duplicados, assets no declarados, hashes incorrectos, versión desconocida, campos fuera de alcance y referencias inexistentes se rechazan antes de restaurar.

El paquete contiene manifest.json (formato/versión/exclusiones/fecha y tamaño+SHA256 de cada archivo), data.json y assets/<sha256>. Los hashes verifican integridad, no autenticidad: nunca se confía en IDs o permisos del archivo. SourceIDs se remapean a UUID nuevos dentro del grafo. No guarda tokens de portal ni reusa aliases/slug de la fuente.

Para ensayar: descargar desde la empresa → abrir una demo interactiva → Estado/Sistema → elegir ZIP → revisar cantidades/exclusiones → confirmar restauración en demo NUEVA. La fuente y la demo anterior quedan intactas. Cancelar preview no crea datos. Sólo se admite destino creado por el servidor, vacío, con isDemo/demoParentId y TTL existentes; no hay selector para restaurar sobre empresa real.

Preview firma digest+actor+empresa durante10min. Apply revalida y usa idempotencia por digest; solicitudes simultáneas restauran un único destino. Factory reutiliza topes/TTL de sandbox pero omite seed comercial. Restauración exacta y demoReady=true se confirman en una sola transacción; ante fallo se revierte y se intenta purgar la demo vacía reservada. Si falla esa limpieza queda no lista para purga existente por TTL, nunca visible como restaurada. Repetir no crea otra; si la demo del recibo ya venció, se informa409. Se cambia sólo la cookie httpOnly de la demo. No se envía correo, cobra, reserva ni restaura prueba de firma.

QA: tests/inventory-backup.test.ts; tests/inventory-backup.pg.test.ts; tests/inventory-backup-http.pg.test.ts (TEST_DATABASE_URL local y BACKUP_TEST_BASE_URL). Los comandos y límites de la entrega quedan en el informe del integrador; esta guía no acredita despliegue ni validación visual.
