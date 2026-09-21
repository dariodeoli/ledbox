# Contexto general de LedBox

> Documento de referencia del proyecto: qué es, qué existe hoy y qué falta.
> Estado relevado el 2026-09-21 sobre la rama `codex/ledbox-gestion-multiempresa` (último commit publicado: `e56cdfd — feat: redesign admin workspace themes`).

## 1. ¿Qué es la app?

LedBox tiene dos partes:

1. **Sitio público comercial:** muestra los equipos y servicios de alquiler.
2. **Panel privado administrativo:** permite gestionar clientes, eventos, presupuestos, proveedores, inventario, promotoras y finanzas.

La aplicación está desarrollada con:

- Next.js 15
- React 19
- TypeScript
- Prisma
- PostgreSQL
- Autenticación propia con JWT
- Google SSO
- Resend para recuperación de contraseña
- Coolify / Owncoding Hub para deploy
- Cloudflare para DNS y proxy

Repositorio: [GitHub LedBox](https://github.com/dariodeoli/ledbox)

Producción:

- [ledbox.online](https://ledbox.online)
- [admin.ledbox.online](https://admin.ledbox.online/admin/login)

## 2. Sitio público

### Catálogo

Actualmente muestra los productos de LedBox:

- Pantallas LED modulares
- Tótem LED
- Tótem Touch
- Kiosko Touch
- Pantalla Multimedia
- Cilindro LED
- Dispensador Inteligente

Cada producto tiene:

- Imagen
- Nombre
- Descripción
- Precio de referencia
- Unidad de cobro
- Tamaño o especificación técnica
- Botón para agregar al pedido

Los precios se aclaran como **precios de lista orientativos**, sujetos a cambios por:

- Cantidad de días
- Cantidad de equipos
- Combinación de equipos
- Traslado
- Instalación
- Soporte
- Necesidades específicas del evento
- Combos personalizados

### Carrito y cotización

El cliente puede:

- Agregar productos al pedido
- Ver el carrito
- Solicitar una cotización
- Enviar la consulta por WhatsApp
- Incluir sus datos de contacto

### Captura de leads

El formulario solicita datos básicos:

- Nombre
- Empresa
- Teléfono
- Email
- RUC
- Tipo de consulta
- Motivo del evento
- Productos de interés

Los leads quedan disponibles en el panel administrativo.

### Servicios publicados

- Pantallas y tecnología visual
- Stands para eventos
- Activaciones de marca
- Coberturas digitales
- Videos
- Reels
- Tomas aéreas con drone
- Instalación y soporte técnico

### Marca y diseño

El sitio conserva el estilo visual definido:

- Fondo negro
- Cyan eléctrico
- Tipografía fuerte
- Tarjetas de productos
- Diseño editorial / tecnológico
- Responsive para celular, tablet y desktop
- Instagram `@ledboxpy`
- WhatsApp
- Link a owncoding.dev
- Footer con versión de la app

### SEO

Ya tiene:

- Metadata principal
- Título y descripción
- Open Graph
- Twitter Cards
- Sitemap
- Robots
- Canonical
- JSON-LD de:
  - Organization
  - LocalBusiness
  - WebSite
  - FAQPage
  - Product
  - Offer
- Favicons
- Manifest PWA
- Apple Touch Icon
- Theme color
- Página 404 personalizada

## 3. Panel administrativo

URL: [admin.ledbox.online/admin/login](https://admin.ledbox.online/admin/login)

### Acceso

Actualmente cuenta con:

- Login por email y contraseña
- Google SSO
- Recuperación de contraseña por email
- Reset de contraseña mediante token
- Sesiones seguras
- Cookies HTTP-only
- Contraseñas con bcrypt
- Roles administrativos
- Activación y desactivación de usuarios

### Roles existentes

- `OWNER`
- `ADMIN`
- `FINANCE`
- `OPERATIONS`
- `VIEWER`

La administración de usuarios permite:

- Crear usuarios
- Asignar rol
- Activarlos
- Desactivarlos
- Administrar socios o colaboradores

### Dashboard

El panel muestra:

- Total de clientes
- Total de eventos
- Presupuestos
- Total por cobrar
- Total por pagar
- Proveedores
- Inventario
- Leads
- Próximos eventos
- Pipeline comercial

El dashboard fue rediseñado para:

- Usar menos espacio vertical
- Mostrar más información rápidamente
- Tener navegación sticky
- Ser responsive
- Usar modo claro y oscuro
- Guardar la preferencia del usuario

## 4. Módulos administrativos actuales

### Clientes

Permite registrar:

- Nombre
- Empresa
- Tipo de cliente
- Cliente final
- Mayorista
- Revendedor
- Teléfono
- Email
- RUC
- Notas

### Eventos

Permite registrar:

- Cliente
- Nombre del evento
- Lugar
- Fecha de inicio
- Estado del evento

Cada evento puede asociarse con:

- Presupuesto
- Equipos
- Proveedores
- Tareas
- Costos
- Pagos

### Checklist operativo

Al crear un evento se generan tareas base:

- Confirmar montaje
- Verificar equipos
- Coordinar desmontaje
- Confirmar cobro o saldo

También se pueden agregar tareas personalizadas y marcarlas como completadas.

### Presupuestos

Permite cargar:

- Cliente
- Evento
- Título
- Producto o servicio
- Cantidad
- Días
- Precio unitario
- Subtotal
- Total
- Estado comercial

Los presupuestos están preparados para calcular:

- Venta
- Costos
- Margen
- Pagos recibidos
- Saldo pendiente

### Finanzas

Actualmente contempla:

#### Cobros de clientes

- Cliente
- Monto
- Método de pago
- Referencia
- Fecha

#### Pagos a proveedores

- Proveedor
- Evento relacionado
- Trabajo contratado
- Costo total
- Anticipo
- Estado
- Fecha prevista
- Pago final

### Proveedores

La base permite registrar:

- Nombre
- Empresa
- Teléfono
- Email
- Especialidad
- Condiciones de pago
- Notas

Categorías previstas:

- Carpintería
- Fabricación
- Gráfica
- Impresión
- Electricidad
- Transporte
- Mobiliario
- Audiovisual
- Otros

### Inventario

El modelo permite controlar:

- Producto
- Categoría
- SKU
- Tipo de elemento
- Reutilizable
- Consumible
- Descartable
- Cantidad
- Estado
- Costo de reposición
- Costo diario
- Notas

También existe control de:

- Equipo asignado a evento
- Cantidad
- Salida
- Entrada
- Estado al retirar
- Estado al devolver

### Promotoras

El modelo contempla:

- Nombre
- Teléfono
- Email
- Foto
- Especialidades
- Notas
- Estado activo
- Asociación a tareas/eventos

## 5. Arquitectura de datos

El sistema tiene modelos para:

- Usuarios
- Organizaciones
- Membresías
- Sesiones
- Leads
- Cotizaciones
- Clientes
- Eventos
- Presupuestos
- Ítems de presupuesto
- Cobros
- Proveedores
- Trabajos de proveedores
- Inventario
- Asignaciones de inventario
- Promotoras
- Tareas de eventos

La base está funcionando en PostgreSQL dentro del entorno de Owncoding/Coolify.

## 6. Infraestructura

Actualmente:

- GitHub conectado a Coolify
- Coolify desplegando desde la rama:
  `codex/ledbox-gestion-multiempresa`
- Cloudflare gestionando DNS/proxy
- Dominio en GoDaddy
- Servidor publicado mediante Owncoding Hub
- PostgreSQL funcionando
- Aplicación pública respondiendo HTTP 200
- Panel administrativo respondiendo HTTP 200
- API health respondiendo HTTP 200

Último commit publicado:

`e56cdfd — feat: redesign admin workspace themes`

## 7. Lo que falta realmente

### Prioridad alta

#### Multiempresa real

Existe una base de `Organization`, `AppUser` y membresías, pero los módulos operativos actuales todavía no están completamente aislados por empresa.

Falta agregar y aplicar:

- `organizationId` a clientes
- `organizationId` a eventos
- `organizationId` a presupuestos
- `organizationId` a proveedores
- `organizationId` a inventario
- `organizationId` a promotoras
- Filtros por organización
- Permisos por organización
- Cambio de empresa activa
- Aislamiento completo de datos

Este es el pendiente arquitectónico más importante si la app se va a ofrecer a varias empresas.

#### Permisos estrictos

Los roles ya existen, pero falta aplicar permisos detallados en todos los endpoints.

Ejemplo:

- `VIEWER`: solo lectura
- `OPERATIONS`: eventos, inventario, checklist
- `FINANCE`: presupuestos, cobros y pagos
- `ADMIN`: administración completa
- `OWNER`: configuración y usuarios

Actualmente parte de esta lógica está implementada, pero todavía no en todos los módulos.

### Prioridad media

#### Inventario operativo visual

Falta completar la interfaz para:

- Asignar equipos a un evento
- Ver disponibilidad por fecha
- Registrar salida
- Registrar devolución
- Registrar daños
- Registrar faltantes
- Cambiar condición del equipo
- Ver conflictos de disponibilidad

#### Flujo completo de proveedores

Falta una interfaz más completa con estados:

- Pendiente de contratar
- Contratado
- Anticipo pendiente
- Anticipo pagado
- En producción
- Entregado
- Saldo pendiente
- Pagado completamente

#### Calendario

Falta integrar una vista calendario más visual con:

- Montajes
- Eventos
- Desmontajes
- Cobros
- Pagos
- Fechas de entrega de proveedores
- Alertas de vencimiento

#### Exportaciones

Falta agregar:

- Exportar presupuestos a PDF
- Exportar eventos a PDF
- Exportar finanzas a CSV
- Exportar inventario
- Descargar reportes mensuales
- Imprimir órdenes de trabajo

#### Auditoría

Falta registrar:

- Quién creó un presupuesto
- Quién modificó un precio
- Quién cambió un estado
- Quién registró un pago
- Quién eliminó o desactivó un registro
- Historial de cambios

### Prioridad baja

- Notificaciones automáticas
- Recordatorios de cobro
- Alertas de eventos próximos
- Integración completa con Google Calendar
- Plantillas de presupuesto
- Precios especiales por cantidad de días
- Precios para clientes finales y revendedores
- Combos configurables
- Fotos y documentación de equipos
- Firma de aceptación de presupuesto
- Estados de aprobación del cliente
- Reportes de rentabilidad por evento
- Dashboard mensual avanzado
- Aplicación móvil o PWA administrativa

## Resumen ejecutivo

Hoy LedBox ya es:

> Un sitio comercial publicado con catálogo, carrito, WhatsApp, captura de leads, SEO, autenticación, panel administrativo, clientes, eventos, presupuestos, finanzas, proveedores, inventario, promotoras y checklist operativo.

Lo más importante que falta para que sea una plataforma empresarial completa es:

1. Multiempresa real con aislamiento de datos.
2. Permisos detallados por rol.
3. Inventario conectado visualmente a cada evento.
4. Calendario operativo.
5. Exportaciones y reportes.
6. Auditoría e historial.
7. Automatizaciones y alertas.

La base actual está bien encaminada. El siguiente salto no es de diseño: es convertirla en un sistema multiempresa completamente aislado y operativo para varias compañías.

## Key Learnings

1. LedBox ya tiene una base comercial y administrativa funcional.
2. El principal pendiente técnico es conectar el modelo multiempresa con todos los datos operativos.
3. Los módulos actuales permiten evolucionar hacia un ERP especializado en eventos, alquileres y producción.

---

## Actualización 21-09-2026

Lo que sigue ya está implementado e integrado (y en producción salvo lo indicado):

- **Panel rediseñado** por módulos (Resumen, Eventos, Calendario, Clientes, Leads, Presupuestos, Finanzas, Inventario, Proveedores, Promotoras, Usuarios, Auditoría), denso, claro/oscuro y mobile; URLs sin `/admin` en `admin.ledbox.online`.
- **Multiempresa real**: `organizationId` en todos los módulos operativos, membresías, empresa activa en sesión y permisos por rol server-side (`lib/server/permissions.ts`).
- **Inventario operativo**: asignaciones por evento con disponibilidad y conflictos, salida/devolución, daños y faltantes, estado del equipo.
- **Proveedores** con flujo completo de estados, anticipos, entrega y saldo.
- **Calendario operativo** (mes/semana/mobile) y **notificaciones** (campana + "Qué mirar hoy").
- **Exportaciones**: presupuesto, orden de trabajo y reporte mensual imprimibles (PDF del navegador) y CSV de finanzas e inventario.
- **Auditoría**: `AuditLog` (actor, acción, entidad, antes/después) y página `/auditoria` (solo OWNER/ADMIN).
- **Portal del cliente** en `clientes.ledbox.online`: presupuesto por link/QR, aprobación digital con evidencia, pedido de cambios, autogestión (cantidades/días, rebaja), plan de cuotas y **datos de pago al aprobar** (Ueno Bank con logo).
- **Cobros a plazo**: factura a 30 días con vencimiento, cheque con su fecha, recordatorios y "marcar cobrado" (los pendientes no cuentan como cobrados).
- **Demo pública full** en `/demo`: datos simulados con eventos reales de Paraguay, ventana móvil y entrada al portal del cliente demo.
- **Deploy**: migraciones automáticas al arrancar (`scripts/migrate-deploy.mjs`) y `/api/health` con estado de base y migraciones.
- **Reglas generales obligatorias** en `docs/REGLAS-GENERALES.md`; adopción del kit de campos canónico en curso (issue #13).
- **Perfil y empresa (issue #22, rama `feat/perfil-empresa`, pendiente de integrar)**: cada usuario edita su nombre, su contraseña (pidiendo la actual) y su foto; un OWNER/ADMIN edita el nombre de la empresa y sube el logo claro y el oscuro (en papel siempre el claro); en Equipo se editan nombre y correo de un usuario (al cambiar el correo se cierran sus sesiones). Todo con auditoría de actor real.

Pendientes declarados: idempotencia y snapshots de operaciones financieras, PIN/bloqueo por inactividad y adjuntar comprobante de pago en el portal.
