CREATE TYPE "SalesPriceAudience" AS ENUM ('RETAIL', 'WHOLESALE');

CREATE TABLE "SalesProductFamily" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "axes" JSONB NOT NULL DEFAULT '[]',
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SalesProductFamily_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SalesProduct" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "familyId" TEXT,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "specifications" JSONB NOT NULL DEFAULT '{}',
    "variantOptions" JSONB NOT NULL DEFAULT '{}',
    "dimensions" JSONB,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SalesProduct_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SalesProductCost" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "originCost" JSONB,
    "chinaInland" JSONB,
    "freight" JSONB,
    "importCost" JSONB,
    "otherCosts" JSONB NOT NULL DEFAULT '[]',
    "cbm" DECIMAL(12,6),
    "landedCost" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SalesProductCost_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SalesProductPriceTier" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "audience" "SalesPriceAudience" NOT NULL,
    "minimumUnits" INTEGER NOT NULL,
    "amount" DECIMAL(14,2),
    "currency" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SalesProductPriceTier_minimumUnits_check" CHECK ("minimumUnits" > 0),
    CONSTRAINT "SalesProductPriceTier_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SalesProductImage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "alt" TEXT,
    "url" TEXT,
    "mime" TEXT,
    "size" INTEGER,
    "data" BYTEA,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SalesProductImage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SalesProductFamily_organizationId_code_key" ON "SalesProductFamily"("organizationId", "code");
CREATE UNIQUE INDEX "SalesProductFamily_id_organizationId_key" ON "SalesProductFamily"("id", "organizationId");
CREATE INDEX "SalesProductFamily_organizationId_archivedAt_idx" ON "SalesProductFamily"("organizationId", "archivedAt");
CREATE UNIQUE INDEX "SalesProduct_organizationId_sku_key" ON "SalesProduct"("organizationId", "sku");
CREATE UNIQUE INDEX "SalesProduct_id_organizationId_key" ON "SalesProduct"("id", "organizationId");
CREATE INDEX "SalesProduct_organizationId_familyId_idx" ON "SalesProduct"("organizationId", "familyId");
CREATE INDEX "SalesProduct_organizationId_archivedAt_idx" ON "SalesProduct"("organizationId", "archivedAt");
CREATE UNIQUE INDEX "SalesProductCost_productId_key" ON "SalesProductCost"("productId");
CREATE UNIQUE INDEX "SalesProductCost_productId_organizationId_key" ON "SalesProductCost"("productId", "organizationId");
CREATE INDEX "SalesProductCost_organizationId_idx" ON "SalesProductCost"("organizationId");
CREATE UNIQUE INDEX "SalesProductPriceTier_productId_audience_minimumUnits_key" ON "SalesProductPriceTier"("productId", "audience", "minimumUnits");
CREATE INDEX "SalesProductPriceTier_organizationId_productId_idx" ON "SalesProductPriceTier"("organizationId", "productId");
CREATE INDEX "SalesProductImage_organizationId_productId_position_idx" ON "SalesProductImage"("organizationId", "productId", "position");

ALTER TABLE "SalesProductFamily" ADD CONSTRAINT "SalesProductFamily_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SalesProduct" ADD CONSTRAINT "SalesProduct_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SalesProduct" ADD CONSTRAINT "SalesProduct_familyId_organizationId_fkey" FOREIGN KEY ("familyId", "organizationId") REFERENCES "SalesProductFamily"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SalesProductCost" ADD CONSTRAINT "SalesProductCost_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SalesProductCost" ADD CONSTRAINT "SalesProductCost_productId_organizationId_fkey" FOREIGN KEY ("productId", "organizationId") REFERENCES "SalesProduct"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SalesProductPriceTier" ADD CONSTRAINT "SalesProductPriceTier_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SalesProductPriceTier" ADD CONSTRAINT "SalesProductPriceTier_productId_organizationId_fkey" FOREIGN KEY ("productId", "organizationId") REFERENCES "SalesProduct"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SalesProductImage" ADD CONSTRAINT "SalesProductImage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SalesProductImage" ADD CONSTRAINT "SalesProductImage_productId_organizationId_fkey" FOREIGN KEY ("productId", "organizationId") REFERENCES "SalesProduct"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
