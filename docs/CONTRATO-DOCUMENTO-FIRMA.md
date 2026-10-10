# Documento público de firma inmutable — I04 / #173

Las nuevas solicitudes usan `documentVersion: 2` en el evento append-only
`REQUEST_CREATED.metadataJson`. `documentSnapshot` contiene la representación
pública canónica completa: emisor, identidad explícita del cliente, evento,
fechas, condiciones, ítems de venta, totales y plan de pagos. No contiene costos.
`documentSnapshotHash` y `commercialHash` sellan ese payload; `documentoHash`
coincide con `SignatureRequest.documentHash`. Sin adjunto, las tres huellas
coinciden; con adjunto, documentHash es SHA-256 de sus bytes reales.

Una sola fábrica en `lib/server/signature/document.ts` proyecta LIVE o valida
snapshot al mismo contrato. V2 usa `clientDisplayName` y razón social explícita,
sin inferir identidad fiscal desde company. Usa `stableOrderBudgetItems` de FIN.
El visor público y la hoja imprimible reconstruyen sólo el snapshot validado,
comprobando cadena de eventos, esquema público estricto y vínculos de hashes.
Ediciones posteriores del cliente, evento, emisor, ítems o plan no cambian el
documento enviado/firmado. La descarga de adjuntos comprueba su hash de bytes.

Firmar sigue leyendo la receta **LIVE** bajo el lock del presupuesto y compara
su commercialHash con la captura, según la versión de la solicitud. Un cambio
comercial posterior provoca 409, aunque el snapshot siga siendo visible.
El snapshot no sustituye este guard ni la protección contra carreras.

Legacy sin snapshot conserva exactamente la receta v1 y `name asc`, sin campos
tradeName/legalName/displayName, sin helper A15 en el hash y sin nuevos null.
Se muestra y firma sólo si esa receta todavía coincide con la captura histórica.
Si ya cambió, el API devuelve 409 y el documento original no se presenta con
contenido actual. No se inventa backfill ni se modifican metadata histórica,
hashes, cadenas o recibos. La receta del sello firmado sigue intacta.

No requiere migración: el snapshot vive en JSON existente. Prueba de regresión:
`tests/signature-snapshot.integration.test.ts`, habilitada sólo con URL HTTP y
Postgres locales aislados `ledbox_quote_qa`; PDF normalizado mediante renderer
configurado por `SIGNATURE_PDF_RENDERER` y salida `QUOTE_EVIDENCE_DIR`.
