import { PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';
import { randomUUID } from 'node:crypto';

const prisma = new PrismaClient();

const admins = [
  { name: 'Dario Deoli', email: 'dariodeoli@gmail.com', passwordEnv: 'LEDBOX_ADMIN_DARIO_PASSWORD' },
  { name: 'Santiago Rodas', email: 'santiago.rodas.sjr@gmail.com', passwordEnv: 'LEDBOX_ADMIN_SANTIAGO_PASSWORD' },
] as const;

const normalizeEmail = (email: string) => email.trim().toLowerCase();
const ADMIN_ALLOWLIST: ReadonlySet<string> = new Set(admins.map((admin) => admin.email));

async function main() {
  for (const admin of admins) {
    const email = normalizeEmail(admin.email);
    if (!ADMIN_ALLOWLIST.has(email)) throw new Error(`Admin email is not allowlisted: ${email}`);
    const password = process.env[admin.passwordEnv];
    if (!password || password.length < 12) {
      throw new Error(`${admin.passwordEnv} must be set to a password of at least 12 characters`);
    }
    await prisma.adminUser.upsert({
      where: { email },
      create: { id: randomUUID(), name: admin.name, email, passwordHash: await hash(password, 12), active: true },
      update: { name: admin.name, active: true, passwordHash: await hash(password, 12) },
    });
  }
  console.log(`Seeded ${admins.length} allowlisted LedBox admins.`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : 'Seed failed');
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
