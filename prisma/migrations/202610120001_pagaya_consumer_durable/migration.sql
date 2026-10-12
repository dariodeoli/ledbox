-- LedBox consumer #182 only. Additive/re-executable; no provider048, seeds or backfill.
CREATE TABLE IF NOT EXISTS "PagaYaEnrollment" (
  "id" TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL, "adminUserId" TEXT NOT NULL,
  "appId" TEXT NOT NULL, "mode" TEXT NOT NULL CHECK ("mode" IN ('test','live')),
  "externalReference" TEXT NOT NULL, "approvedPriceVersionId" TEXT NOT NULL, "customer" JSONB NOT NULL, "customerProvenance" JSONB NOT NULL,
  "checkoutId" TEXT, "subscriptionId" TEXT, "subscriptionSnapshot" JSONB, "snapshotObservedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  FOREIGN KEY ("adminUserId","organizationId") REFERENCES "AdminMembership"("adminUserId","organizationId") ON DELETE RESTRICT ON UPDATE CASCADE,
  UNIQUE ("id","appId","mode"), UNIQUE ("organizationId","adminUserId","appId","mode"),
  UNIQUE ("appId","mode","externalReference"), UNIQUE ("appId","mode","checkoutId"), UNIQUE ("appId","mode","subscriptionId")
);
CREATE TABLE IF NOT EXISTS "PagaYaCommand" (
  "id" TEXT PRIMARY KEY, "enrollmentId" TEXT NOT NULL, "appId" TEXT NOT NULL, "mode" TEXT NOT NULL,
  "intentId" TEXT NOT NULL, "kind" TEXT NOT NULL CHECK ("kind" IN ('CHECKOUT','RENEWAL')),
  "commandKey" TEXT NOT NULL CHECK ("commandKey" ~ '^[!-~]{8,160}$'), "resourceId" TEXT,
  "requestBody" TEXT NOT NULL, "bodySHA256" TEXT NOT NULL CHECK ("bodySHA256" ~ '^[a-f0-9]{64}$'),
  "state" TEXT NOT NULL DEFAULT 'PREPARED' CHECK ("state" IN ('PREPARED','SUBMITTING','UNKNOWN','SUCCEEDED','FAILED')),
  "version" INTEGER NOT NULL DEFAULT 0 CHECK ("version">=0), "responseBody" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  FOREIGN KEY ("enrollmentId","appId","mode") REFERENCES "PagaYaEnrollment"("id","appId","mode") ON DELETE RESTRICT ON UPDATE CASCADE,
  UNIQUE ("enrollmentId","kind","intentId"), UNIQUE ("appId","mode","commandKey")
);
CREATE INDEX IF NOT EXISTS "PagaYaCommand_enrollmentId_state_idx" ON "PagaYaCommand"("enrollmentId","state");
CREATE UNIQUE INDEX IF NOT EXISTS "PagaYaCommand_pending_kind_key" ON "PagaYaCommand"("enrollmentId","kind")
  WHERE "state" IN ('PREPARED','SUBMITTING','UNKNOWN');
CREATE TABLE IF NOT EXISTS "PagaYaInboxEvent" (
  "id" TEXT PRIMARY KEY, "enrollmentId" TEXT NOT NULL, "appId" TEXT NOT NULL, "mode" TEXT NOT NULL,
  "eventType" TEXT NOT NULL CHECK ("eventType" IN ('payment.succeeded','payment.failed','invoice.paid','invoice.payment_failed','subscription.updated','subscription.cancelled','refund.processed')),
  "rawBody" BYTEA NOT NULL, "rawSHA256" TEXT NOT NULL, "payloadSHA256" TEXT NOT NULL, "normalized" JSONB NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'PENDING' CHECK ("state" IN ('PENDING','PROCESSING','PROCESSED')),
  "version" INTEGER NOT NULL DEFAULT 0 CHECK ("version">=0), "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  FOREIGN KEY ("enrollmentId","appId","mode") REFERENCES "PagaYaEnrollment"("id","appId","mode") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "PagaYaInboxEvent_state_createdAt_idx" ON "PagaYaInboxEvent"("state","createdAt");
CREATE TABLE IF NOT EXISTS "PagaYaAccessPeriod" (
  "id" TEXT PRIMARY KEY, "enrollmentId" TEXT NOT NULL, "appId" TEXT NOT NULL, "mode" TEXT NOT NULL,
  "checkoutId" TEXT NOT NULL, "subscriptionId" TEXT NOT NULL, "startsAt" TIMESTAMP(3) NOT NULL, "endsAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CHECK ("endsAt">"startsAt"),
  FOREIGN KEY ("enrollmentId","appId","mode") REFERENCES "PagaYaEnrollment"("id","appId","mode") ON DELETE RESTRICT ON UPDATE CASCADE,
  UNIQUE ("enrollmentId","startsAt","endsAt")
);
CREATE INDEX IF NOT EXISTS "PagaYaAccessPeriod_enrollmentId_endsAt_idx" ON "PagaYaAccessPeriod"("enrollmentId","endsAt");

CREATE OR REPLACE FUNCTION "lbx_pagaya_command_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW."id",NEW."enrollmentId",NEW."appId",NEW."mode",NEW."intentId",NEW."kind",NEW."commandKey",NEW."resourceId",NEW."requestBody",NEW."bodySHA256")
     IS DISTINCT FROM ROW(OLD."id",OLD."enrollmentId",OLD."appId",OLD."mode",OLD."intentId",OLD."kind",OLD."commandKey",OLD."resourceId",OLD."requestBody",OLD."bodySHA256") THEN
    RAISE EXCEPTION 'PAGAYA_IMMUTABLE_COMMAND';
  END IF;
  IF NEW."version"<>OLD."version"+1 OR NOT (
    (OLD."state"='PREPARED' AND NEW."state"='SUBMITTING') OR
    (OLD."state"='SUBMITTING' AND NEW."state" IN ('UNKNOWN','SUCCEEDED','FAILED')) OR
    (OLD."state"='UNKNOWN' AND NEW."state" IN ('SUCCEEDED','FAILED'))
  ) THEN RAISE EXCEPTION 'PAGAYA_INVALID_COMMAND_TRANSITION'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS "PagaYaCommand_immutable" ON "PagaYaCommand";
CREATE TRIGGER "PagaYaCommand_immutable" BEFORE UPDATE ON "PagaYaCommand" FOR EACH ROW EXECUTE FUNCTION "lbx_pagaya_command_immutable"();
CREATE OR REPLACE FUNCTION "lbx_pagaya_enrollment_binding"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW."id",NEW."organizationId",NEW."adminUserId",NEW."appId",NEW."mode",NEW."externalReference",NEW."approvedPriceVersionId",NEW."customer",NEW."customerProvenance")
     IS DISTINCT FROM ROW(OLD."id",OLD."organizationId",OLD."adminUserId",OLD."appId",OLD."mode",OLD."externalReference",OLD."approvedPriceVersionId",OLD."customer",OLD."customerProvenance") OR
     (OLD."checkoutId" IS NOT NULL AND NEW."checkoutId" IS DISTINCT FROM OLD."checkoutId") OR
     (OLD."subscriptionId" IS NOT NULL AND NEW."subscriptionId" IS DISTINCT FROM OLD."subscriptionId") THEN
    RAISE EXCEPTION 'PAGAYA_IMMUTABLE_ENROLLMENT';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS "PagaYaEnrollment_binding" ON "PagaYaEnrollment";
CREATE TRIGGER "PagaYaEnrollment_binding" BEFORE UPDATE ON "PagaYaEnrollment" FOR EACH ROW EXECUTE FUNCTION "lbx_pagaya_enrollment_binding"();
CREATE OR REPLACE FUNCTION "lbx_pagaya_inbox_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW."id",NEW."enrollmentId",NEW."appId",NEW."mode",NEW."eventType",NEW."rawBody",NEW."rawSHA256",NEW."payloadSHA256",NEW."normalized")
     IS DISTINCT FROM ROW(OLD."id",OLD."enrollmentId",OLD."appId",OLD."mode",OLD."eventType",OLD."rawBody",OLD."rawSHA256",OLD."payloadSHA256",OLD."normalized") OR NEW."version"<>OLD."version"+1 OR NOT (
       (OLD."state"='PENDING' AND NEW."state"='PROCESSING') OR
       (OLD."state"='PROCESSING' AND NEW."state" IN ('PENDING','PROCESSED'))
     ) THEN RAISE EXCEPTION 'PAGAYA_IMMUTABLE_INBOX_OR_INVALID_TRANSITION'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS "PagaYaInboxEvent_immutable" ON "PagaYaInboxEvent";
CREATE TRIGGER "PagaYaInboxEvent_immutable" BEFORE UPDATE ON "PagaYaInboxEvent" FOR EACH ROW EXECUTE FUNCTION "lbx_pagaya_inbox_immutable"();
CREATE OR REPLACE FUNCTION "lbx_pagaya_period_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'PAGAYA_IMMUTABLE_PAID_PERIOD';
END $$;
DROP TRIGGER IF EXISTS "PagaYaAccessPeriod_immutable" ON "PagaYaAccessPeriod";
CREATE TRIGGER "PagaYaAccessPeriod_immutable" BEFORE UPDATE ON "PagaYaAccessPeriod" FOR EACH ROW EXECUTE FUNCTION "lbx_pagaya_period_immutable"();
