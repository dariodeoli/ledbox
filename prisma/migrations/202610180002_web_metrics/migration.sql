-- Métricas propias de tráfico y uso de la demo (docs/SUPERADMIN.md «Tráfico»).
-- Aditiva, idempotente y re-ejecutable. Sin IP ni user agent: solo un hash diario truncado.

CREATE TABLE IF NOT EXISTS "WebView" (
    "id" TEXT NOT NULL,
    "viewId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "visitorHash" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "referrerHost" TEXT,
    "device" TEXT NOT NULL,
    "country" TEXT,
    "durationSec" INTEGER,
    "scrollPct" INTEGER,
    "isEntry" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebView_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "WebView_viewId_key" ON "WebView"("viewId");
CREATE INDEX IF NOT EXISTS "WebView_createdAt_idx" ON "WebView"("createdAt");
CREATE INDEX IF NOT EXISTS "WebView_host_createdAt_idx" ON "WebView"("host", "createdAt");
CREATE INDEX IF NOT EXISTS "WebView_path_idx" ON "WebView"("path");

CREATE TABLE IF NOT EXISTS "DemoSession" (
    "id" TEXT NOT NULL,
    "visitorHash" TEXT NOT NULL,
    "sessionId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "durationSec" INTEGER NOT NULL DEFAULT 0,
    "modules" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "DemoSession_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "DemoSession_startedAt_idx" ON "DemoSession"("startedAt");
CREATE INDEX IF NOT EXISTS "DemoSession_visitorHash_startedAt_idx" ON "DemoSession"("visitorHash", "startedAt");
CREATE INDEX IF NOT EXISTS "DemoSession_sessionId_idx" ON "DemoSession"("sessionId");
