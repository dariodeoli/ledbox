"use client";
import { useEffect, useState } from "react";
import { useAdminResource } from "./admin-api";
import type { AdminClientOption } from "./admin-types";

/** Busca antes del límite y conserva por ID el cliente seleccionado. */
export function useClientSelector(selectedId: string) {
  const [query, onSearch] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(query.trim()), 200);
    return () => window.clearTimeout(timer);
  }, [query]);
  const params = new URLSearchParams({ fields: "selector", q: search });
  if (selectedId) params.set("selectedId", selectedId);
  const resource = useAdminResource(`/api/admin/clients?${params}`, (payload) => payload.clients as AdminClientOption[]);
  return { ...resource, onSearch };
}
