import { assertOrganizationSlugAvailable, claimOrganizationSlug, resolveOrganizationSlugId } from "@/lib/server/organization-slugs";
import { Prisma, PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { DEFAULT_MESSAGE_TEMPLATES } from '@/lib/server/message-templates';
import { categoryWriteData, resolveInventoryCategory } from '@/lib/server/inventory-categories';
import { LEDBOX_INVENTORY_CATALOG, ledboxInventoryItemId } from '@/lib/server/inventory-catalog';
import { DEFAULT_PLAN_CODE, PLAN_CATALOG } from '@/lib/plan-rules';

const prisma = new PrismaClient();

// Organización por defecto de LedBox (mismo id estable que usa la migración
// 202609210001_admin_multiempresa). El slug también es el default de
// DEFAULT_ORGANIZATION_SLUG para los endpoints públicos de leads y cotizaciones.
const DEFAULT_ORGANIZATION = { id: 'org_ledbox', name: 'LedBox', slug: 'ledbox' } as const;

// Datos de pago de la empresa (los administra OWNER/ADMIN desde el panel).
// El seed los deja cargados solo si la empresa todavía no tiene ninguno: nunca
// pisa lo que se haya configurado desde el panel.
const PAYMENT_DETAILS = {
  bank: 'Ueno Bank',
  holder: 'Santiago Javier Rodas',
  ruc: null,
  account: '6191649354',
  alias: 'c.i +595 982 029217',
} as const;

const admins = [
  { name: 'Dario Deoli', email: 'dariodeoli@gmail.com', passwordEnv: 'LEDBOX_ADMIN_DARIO_PASSWORD' },
  { name: 'Santiago Rodas', email: 'santiago.rodas.sjr@gmail.com', passwordEnv: 'LEDBOX_ADMIN_SANTIAGO_PASSWORD' },
] as const;

const normalizeEmail = (email: string) => email.trim().toLowerCase();
const ADMIN_ALLOWLIST: ReadonlySet<string> = new Set(admins.map((admin) => admin.email));

async function main() {
  const organization = await prisma.$transaction(async (tx) => {
    // El seed no recrea el identificador viejo de una empresa renombrada.
    const existingId = await resolveOrganizationSlugId(DEFAULT_ORGANIZATION.slug, tx);
    const organizationId = existingId ?? DEFAULT_ORGANIZATION.id;
    await assertOrganizationSlugAvailable(tx, DEFAULT_ORGANIZATION.slug, organizationId);
    const row = await tx.organization.upsert({
      where: { id: organizationId },
      create: { ...DEFAULT_ORGANIZATION, active: true, paymentDetails: PAYMENT_DETAILS },
      update: { name: DEFAULT_ORGANIZATION.name, active: true },
    });
    await claimOrganizationSlug(tx, DEFAULT_ORGANIZATION.slug, row.id);
    return row;
  });
  await prisma.organization.updateMany({
    where: { id: organization.id, paymentDetails: { equals: Prisma.DbNull } },
    data: { paymentDetails: PAYMENT_DETAILS },
  });

  // Plantillas de mensajes (issue #35): solo si la empresa todavía no tiene
  // ninguna, con ids estables e `skipDuplicates`. Misma lista que la provisión
  // de arranque de la migración `202609210020_message_templates` (que cubre el
  // deploy, donde el seed no corre).
  const templateCount = await prisma.messageTemplate.count({ where: { organizationId: organization.id } });
  if (templateCount === 0) {
    await prisma.messageTemplate.createMany({
      data: DEFAULT_MESSAGE_TEMPLATES.map((template) => ({
        id: `${organization.id}_tpl_${template.key}`,
        organizationId: organization.id,
        category: template.category,
        title: template.title,
        body: template.body,
        active: true,
        sortOrder: template.sortOrder,
        createdByName: 'Semilla LedBox',
        updatedByName: 'Semilla LedBox',
      })),
      skipDuplicates: true,
    });
    console.log(`Seeded ${DEFAULT_MESSAGE_TEMPLATES.length} message templates for ${organization.slug}.`);
  }

  // Inventario de arranque (issue #86): los 7 productos del catálogo de la
  // landing (P·01…P·07) con su imagen, solo si la empresa todavía no tiene
  // ítems. Misma lista que la provisión de la migración
  // `202609300001_inventory_item_image` (que cubre el deploy, donde el seed no
  // corre); nunca pisa lo que el equipo haya editado.
  const inventoryCount = await prisma.inventoryItem.count({ where: { organizationId: organization.id } });
  if (inventoryCount === 0) {
    await prisma.inventoryItem.createMany({
      data: LEDBOX_INVENTORY_CATALOG.map((item) => ({
        id: ledboxInventoryItemId(organization.id, item.slug),
        organizationId: organization.id,
        name: item.name,
        category: item.category,
        sku: item.sku,
        imageUrl: item.imageUrl,
        kind: item.kind,
        quantity: item.quantity,
        replacementCost: item.replacementCost,
        dailyCost: item.dailyCost,
        notes: item.notes,
      })),
      skipDuplicates: true,
    });
    // `category` es obligatoria: entra con el texto del catálogo y el helper único la pisa enseguida.
    // La categoría pasa por el helper único: crea la fila de InventoryCategory y deja `categoryId`
    // + el texto espejo «Padre › Hija» (nadie escribe `category` a mano).
    await prisma.$transaction(async (tx) => {
      for (const category of new Set(LEDBOX_INVENTORY_CATALOG.map((item) => item.category))) {
        const resolved = await resolveInventoryCategory(tx, organization.id, { category });
        if (!resolved) throw new Error(`No se pudo resolver la categoría del seed «${category}».`);
        await tx.inventoryItem.updateMany({
          where: { organizationId: organization.id, id: { in: LEDBOX_INVENTORY_CATALOG.filter((item) => item.category === category).map((item) => ledboxInventoryItemId(organization.id, item.slug)) } },
          data: categoryWriteData(resolved),
        });
      }
    });
    console.log(`Seeded ${LEDBOX_INVENTORY_CATALOG.length} inventory items for ${organization.slug}.`);
  }

  // Catálogo de planes (issue #42): misma lista que la migración
  // `202609220027_plans_catalog` y `PLAN_CATALOG` en `lib/plan-rules.ts`. Solo
  // crea los que faltan: nunca pisa precios ni límites ya ajustados.
  await prisma.plan.createMany({
    data: PLAN_CATALOG.map((plan) => ({
      id: plan.id,
      code: plan.code,
      name: plan.name,
      description: plan.description,
      maxUsers: plan.maxUsers,
      maxEventsPerMonth: plan.maxEventsPerMonth,
      priceMonthly: plan.priceMonthly,
      features: [...plan.features],
      sortOrder: plan.sortOrder,
      active: true,
    })),
    skipDuplicates: true,
  });

  // Plan por defecto para la empresa que todavía no tiene (idempotente): los
  // límites se aplican desde el primer uso y el inicio es el alta de la empresa.
  const defaultPlan = PLAN_CATALOG.find((plan) => plan.code === DEFAULT_PLAN_CODE);
  if (defaultPlan) {
    const assigned = await prisma.organization.updateMany({
      where: { id: organization.id, planId: null },
      data: { planId: defaultPlan.id, planStartedAt: organization.createdAt },
    });
    if (assigned.count > 0) {
      console.log(`Assigned default plan ${defaultPlan.code} to ${organization.slug}.`);
    }
  }

  for (const admin of admins) {
    const email = normalizeEmail(admin.email);
    if (!ADMIN_ALLOWLIST.has(email)) throw new Error(`Admin email is not allowlisted: ${email}`);
    const password = process.env[admin.passwordEnv];
    if (!password || password.length < 12) {
      throw new Error(`${admin.passwordEnv} must be set to a password of at least 12 characters`);
    }
    const user = await prisma.adminUser.upsert({
      where: { email },
      create: { id: randomUUID(), name: admin.name, email, passwordHash: await hash(password, 12), role: 'OWNER', active: true },
      update: { name: admin.name, role: 'OWNER', active: true, passwordHash: await hash(password, 12) },
    });
    await prisma.adminMembership.upsert({
      where: { adminUserId_organizationId: { adminUserId: user.id, organizationId: organization.id } },
      create: { id: randomUUID(), adminUserId: user.id, organizationId: organization.id, role: 'OWNER', active: true },
      update: { role: 'OWNER', active: true },
    });
  }

  console.log(`Seeded ${admins.length} allowlisted LedBox admins as OWNER of ${organization.slug} (${organization.id}).`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : 'Seed failed');
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
