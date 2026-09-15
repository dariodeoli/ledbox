CREATE TYPE "AdminRole" AS ENUM ('ADMIN');
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'CONTACTED', 'QUOTED', 'WON', 'LOST');
CREATE TYPE "BillingUnit" AS ENUM ('DAILY', 'SQUARE_METER_DAILY', 'EVENT');

CREATE TABLE "AdminUser" (
  "id" TEXT NOT NULL, "name" TEXT NOT NULL, "email" TEXT NOT NULL, "passwordHash" TEXT NOT NULL,
  "role" "AdminRole" NOT NULL DEFAULT 'ADMIN', "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AdminUser_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AdminUser_email_key" ON "AdminUser"("email");

CREATE TABLE "AdminSession" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "jtiHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL, "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdminSession_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AdminSession_jtiHash_key" ON "AdminSession"("jtiHash");
CREATE INDEX "AdminSession_userId_expiresAt_idx" ON "AdminSession"("userId", "expiresAt");
CREATE INDEX "AdminSession_expiresAt_idx" ON "AdminSession"("expiresAt");

CREATE TABLE "PasswordResetToken" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL, "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");
CREATE INDEX "PasswordResetToken_userId_expiresAt_idx" ON "PasswordResetToken"("userId", "expiresAt");

CREATE TABLE "Lead" (
  "id" TEXT NOT NULL, "name" TEXT NOT NULL, "phone" TEXT NOT NULL, "email" TEXT NOT NULL,
  "company" TEXT, "ruc" TEXT, "reason" TEXT, "eventDate" TIMESTAMP(3), "location" TEXT,
  "message" TEXT, "source" TEXT NOT NULL DEFAULT 'website', "consentAt" TIMESTAMP(3) NOT NULL,
  "status" "LeadStatus" NOT NULL DEFAULT 'NEW', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Lead_status_createdAt_idx" ON "Lead"("status", "createdAt");
CREATE INDEX "Lead_email_idx" ON "Lead"("email");

CREATE TABLE "QuoteRequest" (
  "id" TEXT NOT NULL, "leadId" TEXT, "referenceTotal" INTEGER, "currency" TEXT NOT NULL DEFAULT 'PYG',
  "durationDays" INTEGER, "eventDate" TIMESTAMP(3), "location" TEXT, "source" TEXT NOT NULL DEFAULT 'website',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "QuoteRequest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "QuoteRequest_leadId_createdAt_idx" ON "QuoteRequest"("leadId", "createdAt");

CREATE TABLE "QuoteItem" (
  "id" TEXT NOT NULL, "quoteRequestId" TEXT NOT NULL, "productSlug" TEXT NOT NULL, "productName" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL, "duration" INTEGER, "billingUnit" "BillingUnit" NOT NULL,
  "unitPrice" INTEGER, "subtotal" INTEGER, "notes" TEXT, CONSTRAINT "QuoteItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "QuoteItem_quoteRequestId_idx" ON "QuoteItem"("quoteRequestId");

CREATE TABLE "RateLimitBucket" (
  "id" TEXT NOT NULL, "key" TEXT NOT NULL, "windowStart" TIMESTAMP(3) NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 0, CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RateLimitBucket_key_key" ON "RateLimitBucket"("key");
CREATE INDEX "RateLimitBucket_windowStart_idx" ON "RateLimitBucket"("windowStart");

ALTER TABLE "AdminSession" ADD CONSTRAINT "AdminSession_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "AdminUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "AdminUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QuoteRequest" ADD CONSTRAINT "QuoteRequest_leadId_fkey"
  FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "QuoteItem" ADD CONSTRAINT "QuoteItem_quoteRequestId_fkey"
  FOREIGN KEY ("quoteRequestId") REFERENCES "QuoteRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
