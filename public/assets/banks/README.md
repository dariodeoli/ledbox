# Logos de bancos

Assets oficiales de los bancos usados para los datos de pago del portal del cliente
(se muestran junto a la cuenta de transferencia). Sin hotlinks: el archivo vive acá.

- `ueno.svg` — logo oficial de Ueno Bank (fuente: ueno.com.py, wordmark verde `#2BD98E`,
  funciona en fondo claro y oscuro).

El catálogo de bancos y la resolución del nombre salen de `owncoding-ui`
(`lib/bank-mark.ts`, paso 4 de `docs/ADOPCION-OWNCODING-UI.md`): la librería
resuelve el banco (alias incluidos) y esta app versiona el archivo. Al sumar un
logo: guardarlo acá y registrar la referencia en `REPO_ASSETS`
(`lib/bank-mark.ts`), por ejemplo `"archivo:banco-atlas.png": "/assets/banks/banco-atlas.png"`.
Sin archivo versionado, el banco se dibuja con el monograma (nunca una imagen rota).
