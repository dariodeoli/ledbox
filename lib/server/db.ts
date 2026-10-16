import { PrismaClient } from "@prisma/client";
import { FILTERED_OPERATIONS, isTrashModel, withLiveFilter } from "./trash-filter";

type Globals = { prismaBase?: PrismaClient; prisma?: PrismaClient };
const globalForPrisma = globalThis as unknown as Globals;

/**
 * Cliente base, SIN el filtro de la papelera. Solo para `lib/server/trash.ts` y la purga:
 * es la única forma de ver lo eliminado (`deletedAt` con fecha).
 */
export const dbWithDeleted: PrismaClient = globalForPrisma.prismaBase ?? new PrismaClient();

/**
 * Cliente del producto. Extiende al base para que las lecturas de Event, InventoryItem, InventoryFamily,
 * Client, Lead, Supplier, Promoter y Budget agreguen `deletedAt: null` (docs/PAPELERA.md)
 * salvo que el `where` ya mencione `deletedAt`. `$transaction` del cliente extendido
 * entrega un cliente de transacción también extendido. Los `include`/`select` anidados y
 * `_count` no se filtran: usar `live` de `lib/server/trash-filter.ts`.
 */
function extend(base: PrismaClient): PrismaClient {
  const operations: Record<string, (ctx: { args: unknown; query: (args: unknown) => Promise<unknown> }) => Promise<unknown>> = {};
  for (const operation of FILTERED_OPERATIONS) {
    operations[operation] = ({ args, query }) => query(withLiveFilter(args as { where?: unknown } | undefined));
  }
  const extended = base.$extends({
    query: {
      $allModels: {
        $allOperations({ model, operation, args, query }: { model: string; operation: string; args: unknown; query: (args: unknown) => Promise<unknown> }) {
          const handler = isTrashModel(model) ? operations[operation] : undefined;
          return handler ? handler({ args, query }) : query(args);
        },
      },
    },
  });
  return extended as unknown as PrismaClient;
}

export const db: PrismaClient = globalForPrisma.prisma ?? extend(dbWithDeleted);

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prismaBase = dbWithDeleted;
  globalForPrisma.prisma = db;
}
