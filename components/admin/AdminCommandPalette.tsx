"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import { adminApiGet } from "@/lib/admin-api";
import { ADMIN_ROOT_ID } from "@/lib/admin-theme";
import {
  groupSearchResults,
  SEARCH_MIN_QUERY,
  type AdminSearchResult,
  type AdminSearchResultType,
} from "@/lib/admin-search";
import type { AdminIconName } from "@/lib/admin-types";
import { AdminIcon } from "./AdminIcons";
import { SearchField } from "./AdminFields";
import { AdminButton, AdminDialog, AdminEmpty, AdminErrorState, AdminLoadingRows } from "./AdminUI";

/** Espera del input antes de pegarle al API (el debounce vive en la pantalla). */
const SEARCH_DEBOUNCE_MS = 220;

/** Ícono por tipo de resultado (un ícono por concepto, como el resto del panel). */
const RESULT_ICONS: Record<AdminSearchResultType, AdminIconName> = {
  client: "clients",
  budget: "budgets",
  event: "events",
  user: "users",
};

type AdminSearchPayload = { results?: AdminSearchResult[] };

/**
 * Paleta del buscador global del panel (issue #10). Llega **diferida** desde el
 * shell (issue #67): el botón y el atajo ⌘/Ctrl + K viven en `AdminShell`, así
 * este código no está en el arranque del panel.
 *
 * - Se abre con **⌘/Ctrl + K** o con el botón del topbar; se cierra con Escape,
 *   con el clic afuera o al elegir un resultado (que navega a su módulo).
 * - El input es el campo canónico de búsqueda (`SearchField`) y el resultado lo
 *   decide el API (`/api/admin/search`), que filtra por empresa activa y rol:
 *   acá no se buscan ni se muestran datos de otras empresas.
 * - Teclado: ↑↓ mueven la selección, Enter abre el resultado activo; con menos
 *   de 2 caracteres pide seguir escribiendo y sin coincidencias dice que no hay.
 * - La paleta se monta con `createPortal` en la raíz del panel: el topbar tiene
 *   `backdrop-filter` y eso lo convertiría en el bloque contenedor de un
 *   `position: fixed`, dejando la paleta recortada contra la barra.
 */
export function AdminCommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AdminSearchResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [active, setActive] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Cada apertura arranca limpia: sin consulta vieja ni resultados pegados.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setResults(null);
    setLoading(false);
    setError("");
    setActive(0);
  }, [open]);

  // Al navegar (o si el drawer abre otra pantalla) la paleta se cierra sola.
  // Solo con un cambio real de ruta: en el montaje no se toca (si no, la primera
  // apertura se cerraría sola, issue #67).
  const openRef = useRef(open);
  const pathnameRef = useRef(pathname);
  useEffect(() => {
    openRef.current = open;
  }, [open]);
  useEffect(() => {
    if (pathnameRef.current === pathname) return;
    pathnameRef.current = pathname;
    if (openRef.current) onCloseRef.current();
  }, [pathname]);

  // Búsqueda con debounce y cancelación: la consulta vieja no pisa a la nueva.
  useEffect(() => {
    if (!open) return;
    const term = query.trim();
    if (term.length < SEARCH_MIN_QUERY) {
      setResults(null);
      setLoading(false);
      setError("");
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError("");
    const timer = window.setTimeout(async () => {
      const result = await adminApiGet<AdminSearchPayload>(`/api/admin/search?q=${encodeURIComponent(term)}`, {
        fresh: true,
        signal: controller.signal,
        fallbackError: "No pudimos buscar en el panel.",
      });
      if (controller.signal.aborted) return;
      setLoading(false);
      if (!result.ok) {
        if (!result.sessionInvalid) setError(result.error);
        return;
      }
      setResults(result.data.results ?? []);
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [open, query, attempt]);

  // El diálogo enfoca su botón de cerrar: en la paleta el foco arranca en el
  // buscador, para poder escribir sin tocar el mouse.
  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      rootRef.current?.querySelector<HTMLInputElement>("input")?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  const trimmed = query.trim();
  const ready = trimmed.length >= SEARCH_MIN_QUERY;
  const groups = useMemo(() => groupSearchResults(results ?? []), [results]);
  const flat = useMemo(() => groups.flatMap((group) => group.items), [groups]);
  const optionIndex = useMemo(() => new Map(flat.map((item, index) => [item, index])), [flat]);

  // La selección vuelve al primer resultado con cada búsqueda nueva.
  useEffect(() => {
    setActive(0);
  }, [results]);

  // La opción activa se mantiene a la vista al mover con el teclado.
  useEffect(() => {
    if (!open || flat.length === 0) return;
    rootRef.current?.querySelector<HTMLElement>(`[data-palette-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open, flat.length]);

  const goTo = useCallback(
    (result: AdminSearchResult) => {
      onCloseRef.current();
      router.push(result.href);
    },
    [router],
  );

  function move(delta: number) {
    if (flat.length === 0) return;
    setActive((current) => {
      const next = current + delta;
      if (next < 0) return flat.length - 1;
      if (next >= flat.length) return 0;
      return next;
    });
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    // Solo cuando el foco está en el buscador: en las opciones, Enter es un clic.
    if (!(event.target instanceof HTMLInputElement)) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      move(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      move(-1);
    } else if (event.key === "Enter") {
      const result = flat[active];
      if (!result) return;
      event.preventDefault();
      goTo(result);
    }
  }

  if (!open) return null;

  return createPortal(
    <AdminDialog title="Buscar en el panel" size="wide" onClose={onClose}>
              <div className="admin-palette" ref={rootRef} onKeyDown={onKeyDown}>
                <div className="admin-palette-search">
                  <SearchField
                    value={query}
                    onChange={setQuery}
                    label="Buscar clientes, presupuestos, eventos y usuarios"
                    placeholder="Buscar clientes, presupuestos, eventos…"
                  />
                </div>

                <div className="admin-palette-body" data-loading={loading && flat.length > 0 ? "true" : undefined}>
                  {!ready ? (
                    <p className="admin-palette-hint">Seguí escribiendo: buscamos desde {SEARCH_MIN_QUERY} caracteres.</p>
                  ) : error ? (
                    <AdminErrorState message={error} onRetry={() => setAttempt((current) => current + 1)} />
                  ) : flat.length === 0 ? (
                    loading ? (
                      <AdminLoadingRows rows={3} label="Buscando" />
                    ) : (
                      <AdminEmpty
                        title="Sin resultados"
                        hint={`No encontramos nada para «${trimmed}». Probá con otro nombre, empresa, número o correo.`}
                      />
                    )
                  ) : (
                    <div role="listbox" aria-label="Resultados de la búsqueda">
                      {groups.map((group) => (
                        <section className="admin-palette-group" role="group" aria-label={group.label} key={group.type}>
                          <p className="admin-palette-group-title">{group.label}</p>
                          {group.items.map((item) => {
                            const index = optionIndex.get(item) ?? 0;
                            return (
                              <button
                                type="button"
                                role="option"
                                aria-selected={index === active}
                                data-active={index === active ? "true" : undefined}
                                data-palette-index={index}
                                className="admin-palette-option"
                                key={`${item.type}-${item.id}`}
                                onMouseEnter={() => setActive(index)}
                                onClick={() => goTo(item)}
                              >
                                <AdminIcon name={RESULT_ICONS[item.type]} size={15} />
                                <span className="admin-palette-text">
                                  <strong>{item.title}</strong>
                                  {item.subtitle ? <small>{item.subtitle}</small> : null}
                                </span>
                                <AdminIcon name="arrow-right" size={14} />
                              </button>
                            );
                          })}
                        </section>
                      ))}
                    </div>
                  )}
                </div>

                <p className="admin-palette-foot">
                  <span>
                    <kbd className="admin-palette-kbd">↑</kbd>
                    <kbd className="admin-palette-kbd">↓</kbd> moverse
                  </span>
                  <span>
                    <kbd className="admin-palette-kbd">Enter</kbd> abrir
                  </span>
                  <span>
                    <kbd className="admin-palette-kbd">Esc</kbd> cerrar
                  </span>
                </p>
              </div>
    </AdminDialog>,
    document.getElementById(ADMIN_ROOT_ID) ?? document.body,
  );
}
