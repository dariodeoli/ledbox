import { normalizeInventorySku, inventorySkuValid } from "./field-rules";
import { readBulkChanges } from "./inventory-bulk";
import { readPriceTiers, type PriceTier } from "./price-tiers";
export const SELECTED_PRICE_FIELDS = ["listPrice", "wholesalePrice", "minimumPrice", "tarifasFinal", "tarifasMayorista"] as const;
export type SelectedPriceField = typeof SELECTED_PRICE_FIELDS[number];
export type PriceInstruction = {
    op: "KEEP";
} | {
    op: "CLEAR";
} | {
    op: "REPLACE";
    value: number | PriceTier[];
};
export type SelectedPriceRow = {
    fila: number;
    codigo: string;
    cambios: Partial<Record<SelectedPriceField, PriceInstruction>>;
    errores: string[];
};
export type SelectedPriceResult = {
    fila: number;
    codigo: string;
    estado: "aplicada" | "conservada" | "invalida" | "conflicto" | "pendiente";
    mensaje: string;
    cambios?: Array<{
        campo: string;
        antes: unknown;
        despues: unknown;
    }>;
    replay?: boolean;
};
const object = (raw: unknown): raw is Record<string, unknown> => Boolean(raw) && typeof raw === "object" && !Array.isArray(raw);
/** Raw presence is interpreted before legacy catalogue normalization. No inferred clear. */
export function readSelectedPrices(raw: unknown): {
    ok: true;
    rows: SelectedPriceRow[];
} | {
    ok: false;
    error: string;
} {
    if (!object(raw) || !Array.isArray(raw.productos) || !raw.productos.length || raw.productos.length > 1000)
        return { ok: false, error: "El JSON selectivo necesita entre 1 y 1.000 productos." };
    if (Object.keys(raw).some(key => key !== "productos" && key !== "moneda") || raw.moneda !== undefined && raw.moneda !== "PYG")
        return { ok: false, error: "Este modo sólo acepta productos y moneda PYG; no importa fotos, categorías ni otros datos." };
    const rows = raw.productos.map((entry, index): SelectedPriceRow => {
        const row: SelectedPriceRow = { fila: index + 1, codigo: "", cambios: {}, errores: [] };
        if (!object(entry)) {
            row.errores.push("La fila debe ser un objeto.");
            return row;
        }
        row.codigo = typeof entry.codigo === "string" ? normalizeInventorySku(entry.codigo) : "";
        if (!inventorySkuValid(row.codigo))
            row.errores.push("Código inválido.");
        if (Object.keys(entry).some(key => key !== "codigo" && key !== "cambios"))
            row.errores.push("Sólo se admite código y cambios de precios en este modo.");
        if (!object(entry.cambios)) {
            row.errores.push("Indicá cambios por campo con op KEEP, CLEAR o REPLACE.");
            return row;
        }
        for (const [key, instruction] of Object.entries(entry.cambios)) {
            if (!(SELECTED_PRICE_FIELDS as readonly string[]).includes(key)) {
                row.errores.push(`Campo no soportado: ${key}.`);
                continue;
            }
            const field = key as SelectedPriceField;
            if (!object(instruction) || (typeof instruction.op !== "string" || !["KEEP", "CLEAR", "REPLACE"].includes(instruction.op)) || Object.keys(instruction).some(k => k !== "op" && k !== "value")) {
                row.errores.push(`${key}: instrucción inválida.`);
                continue;
            }
            if (instruction.op === "KEEP" || instruction.op === "CLEAR") {
                if (Object.hasOwn(instruction, "value")) {
                    row.errores.push(`${key}: ${instruction.op} no lleva value.`);
                    continue;
                }
                row.cambios[field] = { op: instruction.op };
                continue;
            }
            if (key === "tarifasFinal" || key === "tarifasMayorista") {
                if (!Array.isArray(instruction.value)) {
                    row.errores.push(`${key}: REPLACE exige una lista explícita.`);
                    continue;
                }
                try {
                    const parsed = readPriceTiers(instruction.value);
                    if (!parsed.ok)
                        row.errores.push(`${key}: ${parsed.error}`);
                    else
                        row.cambios[field] = { op: "REPLACE", value: parsed.tiers };
                }
                catch {
                    row.errores.push(`${key}: lista de escalones inválida.`);
                }
            }
            else {
                const parsed = readBulkChanges("items", { [key]: instruction.value });
                if (instruction.value === null || !parsed)
                    row.errores.push(`${key}: REPLACE exige un importe entero válido; para quitarlo usá CLEAR.`);
                else
                    row.cambios[field] = { op: "REPLACE", value: parsed[key] as number };
            }
        }
        return row;
    });
    const repeated = new Set(rows.filter((r, i) => r.codigo && rows.findIndex(x => x.codigo === r.codigo) !== i).map(r => r.codigo));
    for (const row of rows)
        if (repeated.has(row.codigo))
            row.errores.push("Código repetido: no se aplica ninguna de sus filas.");
    return { ok: true, rows };
}
export function selectedPriceValue(instruction: PriceInstruction, field: SelectedPriceField): number | PriceTier[] | undefined {
    if (instruction.op === "KEEP")
        return undefined;
    return instruction.op === "CLEAR" ? field.startsWith("tarifas") ? [] : 0 : instruction.value;
}
