import { createHash, randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { PagaYaCheckoutRead, PagaYaCommand, PagaYaCommandKind, PagaYaCustomer, PagaYaEnrollment, PagaYaOwner } from "./types";
import { emailError, normalizeEmail, normalizePersonName, personNameValid } from "../../field-rules";

export type PagaYaTx = Pick<Prisma.TransactionClient, "$queryRaw" | "$executeRaw">;
export type PagaYaDatabase = { $transaction<T>(work: (tx: PagaYaTx) => Promise<T>): Promise<T> };
export class PagaYaPersistenceError extends Error {
  constructor(public readonly code: string, public readonly status: 400 | 403 | 404 | 409 = 409) {
    super(code);
    this.name = "PagaYaPersistenceError";
  }
}
export function pagayaDigest(bytes: string | Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}
/** Strict JSON, sorted object keys; no undefined, NaN, Date or lossy coercion. */
export function pagayaCommandBody(value: unknown): string {
  function canonical(item: unknown): unknown {
    if (item === null || typeof item === "string" || typeof item === "boolean") return item;
    if (typeof item === "number" && Number.isFinite(item)) return item;
    if (Array.isArray(item)) return item.map(canonical);
    if (item && typeof item === "object" && Object.getPrototypeOf(item) === Object.prototype) {
      return Object.fromEntries(Object.keys(item).sort().map(key => [key, canonical((item as Record<string, unknown>)[key])]));
    }
    throw new PagaYaPersistenceError("invalid_command_body", 400);
  }
  return JSON.stringify(canonical(value));
}
function requireOwner(owner: PagaYaOwner) {
  if (![owner.organizationId, owner.adminUserId, owner.appId].every(value => typeof value === "string" && value.length > 0)
    || (owner.mode !== "test" && owner.mode !== "live")) throw new PagaYaPersistenceError("invalid_owner", 403);
}

/** Every mutation holds the enrollment lock until commit. New models are used
 * through parameterized SQL, not fabricated generated-client types. No TTL or
 * delete resets command identity. Caller may POST only a successful claim. */
export class PagaYaRepository {
  constructor(readonly database: PagaYaDatabase) {}

  async ownedInTransaction(tx: PagaYaTx, owner: PagaYaOwner, id: string): Promise<PagaYaEnrollment> {
    requireOwner(owner);
    const rows = await tx.$queryRaw<PagaYaEnrollment[]>`
      SELECT e.* FROM "PagaYaEnrollment" e
      JOIN "AdminMembership" m ON m."organizationId"=e."organizationId" AND m."adminUserId"=e."adminUserId"
      JOIN "AdminUser" u ON u."id"=m."adminUserId" JOIN "Organization" o ON o."id"=m."organizationId"
      WHERE e."id"=${id} AND e."organizationId"=${owner.organizationId} AND e."adminUserId"=${owner.adminUserId}
        AND e."appId"=${owner.appId} AND e."mode"=${owner.mode} AND m."active" AND u."active" AND o."active"
      FOR UPDATE OF e
    `;
    if (!rows[0]) throw new PagaYaPersistenceError("enrollment_not_owned", 404);
    return rows[0];
  }

  getOwnedEnrollment(owner: PagaYaOwner, enrollmentId: string) {
    return this.database.$transaction(tx => this.ownedInTransaction(tx, owner, enrollmentId));
  }

  /** approvedPriceVersionId comes from FIN's server-approved catalog mapping,
   * never a price inferred from Plan42 or trusted browser entitlement. */
  createEnrollment(owner: PagaYaOwner, input: {
    externalReference: string; approvedPriceVersionId: string; customer: PagaYaCustomer;
    customerProvenance: { sourceReference: string; approvedByAdminUserId: string };
  }) {
    requireOwner(owner);
    if (!input.externalReference || !input.approvedPriceVersionId) throw new PagaYaPersistenceError("missing_approved_enrollment", 400);
    if (!input.customerProvenance?.sourceReference || input.customerProvenance.approvedByAdminUserId !== owner.adminUserId) {
      throw new PagaYaPersistenceError("server_customer_approval_required", 403);
    }
    const customer = { name: normalizePersonName(input.customer.name), email: normalizeEmail(input.customer.email), phone: input.customer.phone };
    if (!personNameValid(customer.name) || emailError(customer.email) || !/^\+[1-9]\d{6,14}$/.test(customer.phone)) {
      throw new PagaYaPersistenceError("verified_server_customer_required", 400);
    }
    const customerBody = pagayaCommandBody(customer);
    const provenanceBody = pagayaCommandBody({ ...input.customerProvenance, approvedAt: new Date().toISOString() });
    return this.database.$transaction(async tx => {
      const rows = await tx.$queryRaw<PagaYaEnrollment[]>`
        INSERT INTO "PagaYaEnrollment" ("id","organizationId","adminUserId","appId","mode","externalReference","approvedPriceVersionId","customer","customerProvenance","createdAt","updatedAt")
        SELECT ${randomUUID()},m."organizationId",m."adminUserId",${owner.appId},${owner.mode},${input.externalReference},${input.approvedPriceVersionId},${customerBody}::jsonb,${provenanceBody}::jsonb,NOW(),NOW()
        FROM "AdminMembership" m JOIN "AdminUser" u ON u."id"=m."adminUserId" JOIN "Organization" o ON o."id"=m."organizationId"
        WHERE m."organizationId"=${owner.organizationId} AND m."adminUserId"=${owner.adminUserId} AND m."active" AND u."active" AND o."active"
          AND u."name"=${customer.name} AND LOWER(u."email")=${customer.email}
          AND m."role" IN ('OWNER','ADMIN')
        ON CONFLICT ("organizationId","adminUserId","appId","mode") DO NOTHING RETURNING *
      `;
      if (rows[0]) return rows[0];
      const existing = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "PagaYaEnrollment" WHERE "organizationId"=${owner.organizationId} AND "adminUserId"=${owner.adminUserId}
          AND "appId"=${owner.appId} AND "mode"=${owner.mode}
      `;
      if (!existing[0]) throw new PagaYaPersistenceError("enrollment_not_owned", 403);
      const enrollment = await this.ownedInTransaction(tx, owner, existing[0].id);
      if (enrollment.externalReference !== input.externalReference || enrollment.approvedPriceVersionId !== input.approvedPriceVersionId
        || pagayaCommandBody(enrollment.customer) !== customerBody) {
        throw new PagaYaPersistenceError("immutable_enrollment_conflict");
      }
      if (enrollment.customerProvenance.sourceReference !== input.customerProvenance.sourceReference
        || enrollment.customerProvenance.approvedByAdminUserId !== input.customerProvenance.approvedByAdminUserId) {
        throw new PagaYaPersistenceError("immutable_customer_approval_conflict");
      }
      return enrollment;
    });
  }

  reserveCommand(owner: PagaYaOwner, enrollmentId: string, input: {
    intentId: string; kind: PagaYaCommandKind; body: Record<string, unknown>; commandKey?: string;
  }): Promise<PagaYaCommand> {
    if (!input.intentId || !["CHECKOUT", "RENEWAL"].includes(input.kind)) throw new PagaYaPersistenceError("invalid_command_intent", 400);
    const requestBody = pagayaCommandBody(input.body);
    return this.database.$transaction(async tx => {
      const enrollment = await this.ownedInTransaction(tx, owner, enrollmentId);
      if (input.kind === "CHECKOUT") {
        if (!enrollment.customer || !enrollment.customerProvenance?.sourceReference
          || enrollment.customerProvenance.approvedByAdminUserId !== enrollment.adminUserId) {
          throw new PagaYaPersistenceError("billing_customer_unavailable", 403);
        }
        if (input.body.priceVersionId !== enrollment.approvedPriceVersionId || input.body.externalReference !== enrollment.externalReference
          || pagayaCommandBody(input.body.customer) !== pagayaCommandBody(enrollment.customer)
          || Object.keys(input.body).some(key => !["priceVersionId", "externalReference", "customer"].includes(key))) {
          throw new PagaYaPersistenceError("checkout_enrollment_mismatch", 400);
        }
      } else if (!enrollment.subscriptionId || typeof input.body.cancelAtPeriodEnd !== "boolean"
        || Object.keys(input.body).length !== 1) throw new PagaYaPersistenceError("invalid_renewal_command", 400);
      const existing = await tx.$queryRaw<PagaYaCommand[]>`
        SELECT * FROM "PagaYaCommand" WHERE "enrollmentId"=${enrollmentId} AND "kind"=${input.kind} AND "intentId"=${input.intentId}
      `;
      if (existing[0]) {
        if (existing[0].requestBody !== requestBody || (input.commandKey && existing[0].commandKey !== input.commandKey)) {
          throw new PagaYaPersistenceError("immutable_command_conflict");
        }
        return existing[0];
      }
      const pending = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "PagaYaCommand" WHERE "enrollmentId"=${enrollmentId} AND "kind"=${input.kind}
          AND "state" IN ('PREPARED','SUBMITTING','UNKNOWN')
      `;
      if (pending.length) throw new PagaYaPersistenceError("command_reconciliation_required");
      if (input.kind === "CHECKOUT" && enrollment.checkoutId) throw new PagaYaPersistenceError("checkout_already_bound");
      const key = input.commandKey ?? randomUUID();
      if (!/^[\x21-\x7e]{8,160}$/.test(key)) throw new PagaYaPersistenceError("invalid_command_key", 400);
      const rows = await tx.$queryRaw<PagaYaCommand[]>`
        INSERT INTO "PagaYaCommand" ("id","enrollmentId","appId","mode","intentId","kind","commandKey","resourceId","requestBody","bodySHA256","state","version","createdAt","updatedAt")
        VALUES (${randomUUID()},${enrollmentId},${owner.appId},${owner.mode},${input.intentId},${input.kind},${key},
          ${input.kind === "RENEWAL" ? enrollment.subscriptionId : null},${requestBody},${pagayaDigest(requestBody)},'PREPARED',0,NOW(),NOW()) RETURNING *
      `;
      return rows[0];
    });
  }

  getOwnedCommand(owner: PagaYaOwner, enrollmentId: string, commandId: string): Promise<PagaYaCommand> {
    return this.database.$transaction(async tx => {
      await this.ownedInTransaction(tx, owner, enrollmentId);
      const rows = await tx.$queryRaw<PagaYaCommand[]>`
        SELECT * FROM "PagaYaCommand" WHERE "id"=${commandId} AND "enrollmentId"=${enrollmentId}
      `;
      if (!rows[0]) throw new PagaYaPersistenceError("command_not_owned", 404);
      return rows[0];
    });
  }

  /** Commit of this CAS must precede the external POST. UNKNOWN is never
   * claimable: reconcile by read, do not auto-reset or silently mint a key. */
  claimCommand(owner: PagaYaOwner, enrollmentId: string, commandId: string, version: number): Promise<PagaYaCommand | null> {
    return this.database.$transaction(async tx => {
      await this.ownedInTransaction(tx, owner, enrollmentId);
      const rows = await tx.$queryRaw<PagaYaCommand[]>`
        UPDATE "PagaYaCommand" SET "state"='SUBMITTING',"version"="version"+1,"updatedAt"=NOW()
        WHERE "id"=${commandId} AND "enrollmentId"=${enrollmentId} AND "state"='PREPARED' AND "version"=${version} RETURNING *
      `;
      return rows[0] ?? null;
    });
  }

  recordCommandOutcome(owner: PagaYaOwner, enrollmentId: string, commandId: string, version: number,
    outcome: { state: "UNKNOWN" | "SUCCEEDED" | "FAILED"; responseBody: unknown }): Promise<PagaYaCommand | null> {
    if (!["UNKNOWN", "SUCCEEDED", "FAILED"].includes(outcome.state)) throw new PagaYaPersistenceError("invalid_command_outcome", 400);
    const response = pagayaCommandBody(outcome.responseBody);
    return this.database.$transaction(async tx => {
      await this.ownedInTransaction(tx, owner, enrollmentId);
      const rows = await tx.$queryRaw<PagaYaCommand[]>`
        UPDATE "PagaYaCommand" SET "state"=${outcome.state},"responseBody"=${response}::jsonb,"version"="version"+1,"updatedAt"=NOW()
        WHERE "id"=${commandId} AND "enrollmentId"=${enrollmentId} AND "version"=${version}
          AND ("state"='SUBMITTING' OR ("state"='UNKNOWN' AND ${outcome.state}<>'UNKNOWN')) RETURNING *
      `;
      return rows[0] ?? null;
    });
  }

  saveCheckoutRead(owner: PagaYaOwner, enrollmentId: string, checkout: PagaYaCheckoutRead): Promise<PagaYaEnrollment> {
    return this.database.$transaction(async tx => {
      const enrollment = await this.ownedInTransaction(tx, owner, enrollmentId);
      if (typeof checkout.id !== "string" || !checkout.id || checkout.appId !== owner.appId || checkout.mode !== owner.mode
        || (checkout.subscriptionId !== null && (typeof checkout.subscriptionId !== "string" || !checkout.subscriptionId))
        || checkout.externalReference !== enrollment.externalReference
        || checkout.priceVersionId !== enrollment.approvedPriceVersionId
        || (enrollment.checkoutId && enrollment.checkoutId !== checkout.id)
        || (enrollment.subscriptionId && enrollment.subscriptionId !== checkout.subscriptionId)) {
        throw new PagaYaPersistenceError("checkout_read_binding_mismatch");
      }
      const rows = await tx.$queryRaw<PagaYaEnrollment[]>`
        UPDATE "PagaYaEnrollment" SET "checkoutId"=${checkout.id},"subscriptionId"=${checkout.subscriptionId},"updatedAt"=NOW()
        WHERE "id"=${enrollmentId} RETURNING *
      `;
      return rows[0];
    });
  }
}
