import { z } from "zod";

const currencySchema = z.string().trim().regex(/^[A-Z]{3}$/, "Usá un código ISO 4217 de tres letras.");

/** A null amount means unknown; it must never be treated as zero. */
const salesImportMoneySchema = z.object({
  amount: z.number().finite().min(0).nullable(),
  currency: currencySchema,
}).strict();

const nullablePositiveNumber = z.number().finite().positive().nullable();
const nullablePercent = z.number().finite().min(0).max(100).nullable();

const salesProductImportSchema = z.object({
  codigo: z.string().trim().min(1).max(60),
  nombre: z.string().trim().min(1).max(160),
  descripcion: z.string().trim().max(4_000).nullable(),
  categoria: z.string().trim().max(120).nullable(),
  familia: z.string().trim().min(1).max(60).nullable(),
  variante: z.record(z.string(), z.string().trim().min(1).max(100)),
  especificaciones: z.record(z.string(), z.union([z.string(), z.number().finite(), z.boolean(), z.null()])),
  foto: z.string().trim().max(240).nullable(),
  costos: z.object({
    productoEnOrigen: salesImportMoneySchema.nullable(),
    trasladoHastaPuertoChina: salesImportMoneySchema.nullable(),
    cbm: nullablePositiveNumber,
    importacionPorcentaje: nullablePercent,
  }).strict(),
  precios: z.object({
    minorista: salesImportMoneySchema.nullable(),
    mayorista: z.array(z.object({
      cantidadMinima: z.number().int().min(1).max(1_000_000),
      precioUnitario: salesImportMoneySchema,
    }).strict()).max(100),
  }).strict(),
}).strict();

export const salesCatalogImportV1Schema = z.object({
  formato: z.literal("ledbox.catalogo-venta"),
  version: z.literal(1),
  productos: z.array(salesProductImportSchema).min(1).max(2_000),
}).strict().superRefine((catalog, context) => {
  const skuRows = new Map<string, number>();
  const variantRows = new Map<string, number>();

  catalog.productos.forEach((product, index) => {
    const sku = product.codigo.toLocaleLowerCase("es-PY");
    const firstSkuRow = skuRows.get(sku);
    if (firstSkuRow !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["productos", index, "codigo"],
        message: `Código repetido en los productos ${firstSkuRow + 1} y ${index + 1}.`,
      });
    } else {
      skuRows.set(sku, index);
    }

    const optionCount = Object.keys(product.variante).length;
    if (product.familia && optionCount === 0) {
      context.addIssue({
        code: "custom",
        path: ["productos", index, "variante"],
        message: "Un producto con familia necesita al menos una opción de variante.",
      });
    }
    if (!product.familia && optionCount > 0) {
      context.addIssue({
        code: "custom",
        path: ["productos", index, "familia"],
        message: "Indicá la familia para agrupar las opciones de variante.",
      });
    }

    if (product.familia && optionCount > 0) {
      const optionsKey = Object.entries(product.variante)
        .map(([key, value]) => `${key.trim().toLocaleLowerCase("es-PY")}=${value.trim().toLocaleLowerCase("es-PY")}`)
        .sort()
        .join("|");
      const variantKey = `${product.familia.toLocaleLowerCase("es-PY")}::${optionsKey}`;
      const firstVariantRow = variantRows.get(variantKey);
      if (firstVariantRow !== undefined) {
        context.addIssue({
          code: "custom",
          path: ["productos", index, "variante"],
          message: `La combinación de opciones de variante ya aparece en el producto ${firstVariantRow + 1}.`,
        });
      } else {
        variantRows.set(variantKey, index);
      }
    }

    if (product.foto !== null) {
      const parts = product.foto.split("/");
      const validPath = !product.foto.startsWith("/")
        && !product.foto.includes("\\")
        && parts.every((part) => part.length > 0 && part !== "." && part !== "..");
      const validExtension = /\.(jpe?g|png|webp)$/i.test(product.foto);
      if (!validPath || !validExtension) {
        context.addIssue({
          code: "custom",
          path: ["productos", index, "foto"],
          message: "La foto debe ser una ruta relativa segura a JPG, PNG o WebP dentro del ZIP.",
        });
      }
    }

    const thresholds = product.precios.mayorista.map((tier) => tier.cantidadMinima);
    if (new Set(thresholds).size !== thresholds.length) {
      context.addIssue({
        code: "custom",
        path: ["productos", index, "precios", "mayorista"],
        message: "No repitas cantidades mínimas en los tramos mayoristas.",
      });
    }
  });
});

export type SalesCatalogImportV1 = z.infer<typeof salesCatalogImportV1Schema>;

/** Parse/preview contract only. This function has no persistence or inventory side effects. */
export function parseSalesCatalogImportV1(input: unknown) {
  return salesCatalogImportV1Schema.safeParse(input);
}
