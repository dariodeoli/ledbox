"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ADMIN_REFRESH_EVENT, adminApiGet } from "@/lib/admin-api";
import type { AdminApiResponse, AdminInventoryGridRow } from "@/lib/admin-types";

/** Productos por pedido: el API acepta hasta 300; con 200 una empresa de 250 son dos pedidos. */
const PAGE_SIZE = 200;
/** Tope de seguridad de páginas (60.000 productos): corta un cursor que no termine. */
const MAX_PAGES = 300;

/**
 * Lista liviana del inventario (`?fields=grid`): pide página por página con el cursor hasta
 * completarla, sin el tope de 300 de la lista vieja, y la va mostrando a medida que llega. Con
 * rango (`startsAt`/`endsAt`) cada fila trae además la disponibilidad de ese rango.
 */
export function useInventoryGrid(range: { from: string; to: string }) {
  const [rows, setRows] = useState<AdminInventoryGridRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [total, setTotal] = useState<number | null>(null);
  const runId = useRef(0);

  const rangeKey = `${range.from}|${range.to}`;
  const load = useCallback(
    async (fresh: boolean) => {
      const run = ++runId.current;
      const [from, to] = rangeKey.split("|");
      setLoading(true);
      setError("");
      const collected: AdminInventoryGridRow[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const params = new URLSearchParams({ fields: "grid", limit: String(PAGE_SIZE) });
        if (cursor) params.set("cursor", cursor);
        if (from && to) {
          params.set("startsAt", `${from}T00:00`);
          params.set("endsAt", `${to}T23:59`);
        }
        const result = await adminApiGet<AdminApiResponse>(`/api/admin/inventory?${params.toString()}`, {
          fresh: fresh || page > 0,
          fallbackError: "No pudimos cargar el inventario.",
        });
        if (run !== runId.current) return;
        if (!result.ok) {
          if (!result.sessionInvalid) console.error("[inventario] no se pudo cargar la página", page, result.error);
          if (!result.sessionInvalid) setError(result.error);
          setLoading(false);
          return;
        }
        collected.push(...((result.data.inventory ?? []) as AdminInventoryGridRow[]));
        if (typeof result.data.total === "number") setTotal(result.data.total);
        setRows([...collected]);
        cursor = result.data.nextCursor ?? null;
        if (!cursor) break;
      }
      if (run === runId.current) setLoading(false);
    },
    [rangeKey],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  useEffect(() => {
    const onRefresh = () => void load(true);
    window.addEventListener(ADMIN_REFRESH_EVENT, onRefresh);
    return () => window.removeEventListener(ADMIN_REFRESH_EVENT, onRefresh);
  }, [load]);

  const reload = useCallback(() => void load(true), [load]);
  return { data: rows, loading, error, total, reload };
}

/** Productos con una unidad cuyo código coincide con la búsqueda (con espera para no pedir por cada tecla). */
export function useUnitCodeMatches(query: string): ReadonlySet<string> {
  const [ids, setIds] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    const text = query.trim();
    if (text.length < 2) {
      setIds(new Set());
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void adminApiGet<AdminApiResponse>(`/api/admin/inventory?fields=grid&unitMatch=${encodeURIComponent(text)}`, { signal: controller.signal, skipSessionRedirect: true }).then((result) => {
        if (result.ok) setIds(new Set(result.data.matchedIds ?? []));
        else if (!result.aborted) console.error("[inventario] no se pudo buscar por código de unidad", result.error);
      });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);
  return ids;
}
