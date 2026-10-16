# Cantidades, días y contraofertas

Las cantidades y días comerciales adoptan `NumberField strictInteger`, la misma validación usada por el contador compartido. No se cambia el modo predeterminado de todos los campos: porcentajes, horas, orden y geometría conservan sus contratos.

Un entero válido se emite como texto normalizado y se admite el borrador vacío. Signos, separadores decimales o exponentes no se convierten quitándoles caracteres. Cada consumidor mantiene sus límites de negocio; el servidor los vuelve a validar.

Las contraofertas conservan borradores de texto por línea. Si falta una cantidad o un día, no se puede aplicar. La conversión a números se hace al confirmar mediante `resolveQuoteSelection`; exclusión y cálculo usan las funciones canónicas de precio congelado. Las tarifas TOTAL, los precios manuales y el cobro por evento mantienen su tratamiento propio. El DTO de solicitudes incluye únicamente el snapshot y la unidad de cobro que necesita esa interpretación.

La aceptación compara los mismos campos del presupuesto antes y después de adquirir el bloqueo comercial, incluido el snapshot. Se corrigió un falso conflicto causado por comparar una lectura con snapshot contra otra que lo omitía. La protección ante cambios reales sigue vigente.

La variante editable de la tabla compartida apila las filas en celular, con etiquetas y campos completos; conserva los encabezados accesibles y los nombres de los controles. No crea otro modal o kit de campos.

El carrito limpia el departamento cuando el usuario vacía la ciudad. Seleccionar una ciudad del catálogo actualiza ambos; una selección que no se edita se conserva.

Pruebas causales: eventos reales del componente y del envío de contraoferta, DTO proyectado, tarifas TOTAL/manual/EVENT, exclusión y reingreso. La prueba HTTP/PostgreSQL `tests/counteroffer-http140.pg.test.ts` comprueba aplicación, total persistido, aislamiento y doble resolución. También bloquea realmente el presupuesto, modifica sólo el snapshot mientras la aceptación espera y comprueba que responde 409 sin sobrescribir ni aceptar. No necesita servicios externos.

Esta entrega corrige consumidores concretos. La auditoría general de campos permanece en #264 y el alcance amplio de la conversación de presupuestos en #143.
