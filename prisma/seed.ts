import { Prisma, PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { DEFAULT_MESSAGE_TEMPLATES } from '@/lib/server/message-templates';

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
  const organization = await prisma.organization.upsert({
    where: { slug: DEFAULT_ORGANIZATION.slug },
    create: { ...DEFAULT_ORGANIZATION, active: true, paymentDetails: PAYMENT_DETAILS },
    update: { name: DEFAULT_ORGANIZATION.name, active: true },
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
