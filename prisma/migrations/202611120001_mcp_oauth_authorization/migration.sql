CREATE TABLE "McpOAuthAuthorization" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "redirectUri" TEXT NOT NULL,
    "responseState" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "requestedScopes" TEXT[] NOT NULL,
    "approvedScopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "codeChallenge" TEXT NOT NULL,
    "codeChallengeMethod" TEXT NOT NULL,
    "consentTokenHash" TEXT NOT NULL,
    "codeHash" TEXT,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "consentExpiresAt" TIMESTAMP(3) NOT NULL,
    "codeExpiresAt" TIMESTAMP(3),
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "McpOAuthAuthorization_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "McpOAuthAccessToken" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "scopes" TEXT[] NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "McpOAuthAccessToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "McpOAuthAuthorization_consentTokenHash_key" ON "McpOAuthAuthorization"("consentTokenHash");
CREATE UNIQUE INDEX "McpOAuthAuthorization_codeHash_key" ON "McpOAuthAuthorization"("codeHash");
CREATE INDEX "McpOAuthAuthorization_userId_organizationId_clientId_createdAt_idx" ON "McpOAuthAuthorization"("userId", "organizationId", "clientId", "createdAt");
CREATE INDEX "McpOAuthAuthorization_consentExpiresAt_idx" ON "McpOAuthAuthorization"("consentExpiresAt");
CREATE INDEX "McpOAuthAuthorization_codeExpiresAt_idx" ON "McpOAuthAuthorization"("codeExpiresAt");
CREATE UNIQUE INDEX "McpOAuthAccessToken_tokenHash_key" ON "McpOAuthAccessToken"("tokenHash");
CREATE INDEX "McpOAuthAccessToken_organizationId_userId_expiresAt_idx" ON "McpOAuthAccessToken"("organizationId", "userId", "expiresAt");
CREATE INDEX "McpOAuthAccessToken_expiresAt_idx" ON "McpOAuthAccessToken"("expiresAt");
CREATE INDEX "McpOAuthAccessToken_clientId_revokedAt_idx" ON "McpOAuthAccessToken"("clientId", "revokedAt");

ALTER TABLE "McpOAuthAuthorization" ADD CONSTRAINT "McpOAuthAuthorization_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AdminUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "McpOAuthAuthorization" ADD CONSTRAINT "McpOAuthAuthorization_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "McpOAuthAccessToken" ADD CONSTRAINT "McpOAuthAccessToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AdminUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "McpOAuthAccessToken" ADD CONSTRAINT "McpOAuthAccessToken_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
