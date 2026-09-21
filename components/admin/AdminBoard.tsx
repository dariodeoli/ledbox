"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatDateShort, formatMoney, statusTone, type AdminTone } from "@/lib/admin-format";
import { AdminBadge, AdminCountdown, AdminSelect } from "./AdminUI";
import { AdminIcon } from "./AdminIcons";

/**
 * Tablero kanban único del panel (issue #26).
 *
 * Una sola implementación para Leads, Presupuestos, Proveedores→trabajos y
 * Eventos: columnas por estado (tono + contador), tarjetas con identidad y
 * dato clave, arrastre nativo HTML5 con actualización optimista, y el menú
 * «Mover a…» como alternativa accesible (el drag nunca es la única vía).
 * El módulo describe columnas/tarjetas y el PATCH real; el tablero no conoce
 * ningún endpoint.
 *
 * El scroll horizontal de las columnas es silencioso y con `scroll-snap` en
 * pantallas chicas, sin desbordar la página.
 */

export type AdminModuleView = "list" | "board";

/** Vista recordada por usuario y módulo (`localStorage`); por defecto, lista. */
export function useAdminModuleView(module: string): [AdminModuleView, (view: AdminModuleView) => void] {
  const [view, setView] = useState<AdminModuleView>("list");

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(`ledbox-admin-view:${module}`);
      if (stored === "board" || stored === "list") setView(stored);
    } catch {
      /* almacenamiento no disponible: la vista vale solo para esta pantalla */
    }
  }, [module]);

  const change = useCallback(
    (next: AdminModuleView) => {
      setView(next);
      try {
        window.localStorage.setItem(`ledbox-admin-view:${module}`, next);
      } catch {
        /* almacenamiento no disponible: la vista vale solo para esta pantalla */
      }
    },
    [module],
  );

  return [view, change];
}

/** Conmutador lista/tablero: una sola pieza para todos los módulos. */
export function AdminViewSwitch({
  view,
  onChange,
  label,
}: {
  view: AdminModuleView;
  onChange: (view: AdminModuleView) => void;
  /** Nombre de la vista para lectores («Vista de leads»). */
  label: string;
}) {
  return (
    <div className="admin-viewswitch" role="group" aria-label={label}>
      <button type="button" className="admin-viewswitch-btn" aria-pressed={view === "list"} onClick={() => onChange("list")}>
        <AdminIcon name="menu" size={14} />
        Lista
      </button>
      <button type="button" className="admin-viewswitch-btn" aria-pressed={view === "board"} onClick={() => onChange("board")}>
        <AdminIcon name="overview" size={14} />
        Tablero
      </button>
    </div>
  );
}

export type AdminBoardColumn = {
  value: string;
  label: string;
  /** Tono del estado; sin él sale de `statusTone`. */
  tone?: AdminTone;
};

export type AdminBoardCardData = {
  id: string;
  /** Estado real de la fila (columna donde vive). */
  status: string;
  /** Identidad de la tarjeta (lead, presupuesto, trabajo, evento). */
  title: string;
  /** Línea secundaria: cliente, proveedor, empresa, lugar. */
  subtitle?: string | null;
  /** Monto clave en guaraníes; `null` no dibuja monto. */
  amount?: number | null;
  /** Aclaración del monto («saldo», «estimado»). */
  amountNote?: string | null;
  /** Fecha clave con su cuenta regresiva (`AdminCountdown`). */
  date?: string | null;
  /** Explicación del chip de cuenta regresiva. */
  dateTitle?: string;
  /** Etiquetas propias de la fila (portal, checklist, cierre). */
  badges?: Array<{ label: string; tone?: AdminTone; title?: string }>;
  /** Texto de apoyo del pie (ítems, equipos, condiciones). */
  detail?: string | null;
  /** Acciones del módulo para esta tarjeta. */
  actions?: React.ReactNode;
  /**
   * Estados destino permitidos (máquina de estados del módulo/API). Sin este
   * campo se permiten todos los demás; una lista vacía deja la tarjeta fija.
   */
  targets?: readonly string[];
};

export type AdminBoardMoveOutcome = { ok: true } | { ok: false; error: string };

const NO_MOVING_IDS: ReadonlySet<string> = new Set<string>();

/**
 * Movimiento optimista compartido: la tarjeta cambia de columna al soltar, el
 * `move` del módulo pega el PATCH real y, si el API rechaza (por ejemplo una
 * transición inválida de proveedores), se revierte y se avisa con el error.
 *
 * Idempotencia: soltar en la misma columna no dispara request y una tarjeta con
 * un movimiento en vuelo no acepta otro (single-flight). El cambio es un set de
 * estado, así que reintentar el mismo PATCH es seguro. El override se limpia
 * solo cuando el dato real ya coincide (recarga del recurso).
 */
export function useAdminBoardMove<Row extends { id: string; status: string }>({
  rows,
  move,
  onError,
}: {
  rows: readonly Row[];
  move: (row: Row, status: string) => Promise<AdminBoardMoveOutcome>;
  onError: (message: string) => void;
}): { rows: Row[]; moveTo: (id: string, status: string) => void; movingIds: ReadonlySet<string> } {
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [movingIds, setMovingIds] = useState<ReadonlySet<string>>(NO_MOVING_IDS);
  const rowsRef = useRef(rows);
  const overridesRef = useRef(overrides);
  const inFlightRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  useEffect(() => {
    overridesRef.current = overrides;
  }, [overrides]);

  // El estado real ya alcanzó al optimista (o la fila desapareció): el override sobra.
  useEffect(() => {
    setOverrides((current) => {
      const entries = Object.entries(current);
      if (entries.length === 0) return current;
      const next: Record<string, string> = {};
      for (const [id, status] of entries) {
        const row = rows.find((candidate) => candidate.id === id);
        if (row && row.status !== status) next[id] = status;
      }
      return Object.keys(next).length === entries.length ? current : next;
    });
  }, [rows]);

  const effective = useMemo(
    () =>
      rows.map((row) => {
        const optimistic = overrides[row.id];
        return optimistic && optimistic !== row.status ? { ...row, status: optimistic } : row;
      }),
    [rows, overrides],
  );

  const moveTo = useCallback(
    (id: string, status: string) => {
      const row = rowsRef.current.find((candidate) => candidate.id === id);
      // El estado vigente es el optimista (si lo hay): pedir la columna en la que
      // la tarjeta ya está es un no-op, y volver atrás se pide igual al API.
      const vigente = overridesRef.current[id] ?? row?.status;
      if (!row || vigente === status || inFlightRef.current.has(id)) return;
      inFlightRef.current.add(id);
      setOverrides((current) => ({ ...current, [id]: status }));
      setMovingIds((current) => new Set(current).add(id));
      void move(row, status)
        .then((result) => {
          if (result.ok) return;
          // Revert del optimista: la tarjeta vuelve a su columna real + aviso.
          setOverrides((current) => {
            const next = { ...current };
            delete next[id];
            return next;
          });
          onError(result.error);
        })
        .finally(() => {
          inFlightRef.current.delete(id);
          setMovingIds((current) => {
            if (!current.has(id)) return current;
            const next = new Set(current);
            next.delete(id);
            return next;
          });
        });
    },
    [move, onError],
  );

  return { rows: effective, moveTo, movingIds };
}

export function AdminBoard({
  label,
  columns,
  cards,
  canMove = false,
  movingIds = NO_MOVING_IDS,
  moveLabel = "Mover a…",
  onMove,
}: {
  /** Nombre del tablero para lectores de pantalla («Leads», «Trabajos»). */
  label: string;
  columns: readonly AdminBoardColumn[];
  cards: readonly AdminBoardCardData[];
  /** Rol con permiso de escritura: sin él no hay arrastre ni «Mover a…». */
  canMove?: boolean;
  movingIds?: ReadonlySet<string>;
  moveLabel?: string;
  onMove?: (id: string, status: string) => void;
}) {
  const [draggingId, setDraggingId] = useState("");
  const [overColumn, setOverColumn] = useState("");

  // Estados que llegan en los datos sin columna declarada: se dibujan igual,
  // con su valor crudo, para no ocultar filas.
  const statuses = useMemo(() => {
    const declared = new Set(columns.map((column) => column.value));
    const extra = [...new Set(cards.map((card) => card.status).filter((status) => !declared.has(status)))].sort();
    return [
      ...columns,
      ...extra.map((value) => ({ value, label: value, tone: statusTone(value) })),
    ];
  }, [columns, cards]);

  const grouped = useMemo(() => {
    const map = new Map<string, AdminBoardCardData[]>();
    for (const column of statuses) map.set(column.value, []);
    for (const card of cards) map.get(card.status)?.push(card);
    return map;
  }, [statuses, cards]);

  /** Destinos reales de una tarjeta: su máquina de estados o todas las columnas. */
  const targetsOf = useCallback(
    (card: AdminBoardCardData): string[] => {
      const allowed = card.targets ?? statuses.map((column) => column.value);
      return allowed.filter((value, index) => value !== card.status && allowed.indexOf(value) === index);
    },
    [statuses],
  );

  const draggingCard = draggingId ? cards.find((card) => card.id === draggingId) ?? null : null;
  const accepts = (card: AdminBoardCardData | null, status: string) =>
    Boolean(onMove && canMove && card && !movingIds.has(card.id) && targetsOf(card).includes(status));

  function endDrag() {
    setDraggingId("");
    setOverColumn("");
  }

  return (
    <div className="admin-board-wrap">
      <div className="admin-board" role="group" aria-label={label}>
        {statuses.map((column) => {
          const columnCards = grouped.get(column.value) ?? [];
          const tone: AdminTone = column.tone ?? statusTone(column.value);
          const over = overColumn === column.value && accepts(draggingCard, column.value);
          return (
            <section
              key={column.value}
              className="admin-board-col"
              data-status={column.value}
              data-tone={tone}
              data-over={over || undefined}
              aria-label={`${column.label}: ${columnCards.length}`}
              onDragOver={(event) => {
                if (!accepts(draggingCard, column.value)) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                setOverColumn(column.value);
              }}
              onDragLeave={() => setOverColumn((current) => (current === column.value ? "" : current))}
              onDrop={(event) => {
                if (!accepts(draggingCard, column.value)) return;
                event.preventDefault();
                const id = event.dataTransfer.getData("text/plain") || draggingId;
                endDrag();
                if (id) onMove?.(id, column.value);
              }}
            >
              <header className="admin-board-col-head">
                <span className="admin-board-col-dot" aria-hidden="true" />
                <h3 className="admin-board-col-title">{column.label}</h3>
                <span className="admin-board-col-count" title={`${columnCards.length} tarjeta${columnCards.length === 1 ? "" : "s"}`}>
                  {columnCards.length}
                </span>
              </header>
              <div className="admin-board-cards">
                {columnCards.map((card) => {
                  const targets = targetsOf(card);
                  const movable = Boolean(onMove && canMove && targets.length > 0 && !movingIds.has(card.id));
                  const hasAmount = card.amount !== null && card.amount !== undefined;
                  return (
                    <article
                      key={card.id}
                      className="admin-board-card"
                      data-status={card.status}
                      data-moving={movingIds.has(card.id) || undefined}
                      aria-busy={movingIds.has(card.id) || undefined}
                      draggable={movable}
                      onDragStart={(event) => {
                        if (!movable) {
                          event.preventDefault();
                          return;
                        }
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", card.id);
                        setDraggingId(card.id);
                      }}
                      onDragEnd={endDrag}
                    >
                      <div className="admin-board-card-head">
                        <strong className="admin-board-card-title" title={card.title}>
                          {card.title}
                        </strong>
                        {card.actions ? <span className="admin-board-card-actions">{card.actions}</span> : null}
                      </div>
                      {card.subtitle ? (
                        <p className="admin-board-card-sub" title={card.subtitle}>
                          {card.subtitle}
                        </p>
                      ) : null}
                      {card.badges && card.badges.length > 0 ? (
                        <div className="admin-board-card-badges">
                          {card.badges.map((badge) => (
                            <AdminBadge key={badge.label} tone={badge.tone} title={badge.title}>
                              {badge.label}
                            </AdminBadge>
                          ))}
                        </div>
                      ) : null}
                      {hasAmount || card.date ? (
                        <div className="admin-board-card-facts">
                          {hasAmount ? (
                            <span className="admin-board-card-amount" title={formatMoney(card.amount ?? null)}>
                              {formatMoney(card.amount ?? null)}
                              {card.amountNote ? <small className="admin-cell-sub"> {card.amountNote}</small> : null}
                            </span>
                          ) : null}
                          {card.date ? (
                            <span className="admin-board-card-date">
                              <span className="admin-nowrap">{formatDateShort(card.date)}</span>
                              <AdminCountdown value={card.date} short title={card.dateTitle} />
                            </span>
                          ) : null}
                        </div>
                      ) : null}
                      {card.detail ? <p className="admin-board-card-detail">{card.detail}</p> : null}
                      {movable ? (
                        <div
                          className="admin-board-card-move"
                          /* El select no inicia arrastre: mover con teclado manda. */
                          onDragStart={(event) => event.preventDefault()}
                        >
                          <AdminSelect
                            className="admin-board-move"
                            value=""
                            onChange={(value) => {
                              if (value) onMove?.(card.id, value);
                            }}
                            label={`Mover ${card.title} a otro estado`}
                            title={moveLabel}
                            options={[{ value: "", label: moveLabel }, ...targets.map((value) => ({ value, label: statuses.find((column) => column.value === value)?.label ?? value }))]}
                          />
                        </div>
                      ) : null}
                    </article>
                  );
                })}
                {columnCards.length === 0 ? <p className="admin-board-col-empty">Sin tarjetas</p> : null}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
