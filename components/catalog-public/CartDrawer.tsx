"use client";

import { useRef, useState, type FormEvent } from "react";
import { CityField, EmailField, MoneyField, PhoneField, SelectField, TextAreaField, TextField } from "@/components/admin/AdminFields";
import { deliveryExtraApplies, deliveryRateText } from "@/lib/delivery-zones";
import { PRICE_AMOUNT_MAX, PRICE_COMMENT_MAX, parsePriceAmount } from "@/lib/price-request";
import type { PriceMode } from "@/lib/appearance";
import { formatGs, priceUnitLabel, PREORDER_COPY, preorderEstimate } from "@/lib/storefront-ui";
import type { CartView } from "@/lib/server/store-cart";
import type { CatalogZoneView } from "./CatalogBrowser";
import { EventPicker } from "./EventPicker";
import { ProductPlaceholder, XIcon } from "./StoreIcons";
import { Stepper } from "./Stepper";
import { skuLabel } from "./ProductTile";
import { useModalBehavior } from "./ThemePortal";

/**
 * Pedido (carrito): cajón de 480 px en escritorio y hoja inferior en móvil. Arriba van las FECHAS del evento (dentro del
 * cajón); si faltan, un aviso neutro (nunca rojo). Después las líneas (miniatura real o ícono del tema, nombre, código,
 * cantidad, subtotal y «Quitar»), el flete, el resumen con «Total estimado» y «Confirmamos el monto final en la cotización»
 * (nunca «A cotizar» junto a un total), y los botones: «Enviar pedido» (primario) y «Seguir eligiendo». Dos pasos: pedido y
 * tus datos. La preorden NO es una reserva y la pantalla final lo dice con todas las letras.
 */

export type Done =
  | { kind: "saved"; respondBy: string; trackingPath: string; whatsappUrl: string | null; priceRequested: boolean }
  | { kind: "simulated"; message: string };

const respondFormat = new Intl.DateTimeFormat("es-PY", { timeZone: "America/Asuncion", weekday: "long", day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

export type CartDrawerLine = { id: string; name: string; sku: string | null; quantity: number; imageUrl: string | null; pieces: string | null; step: number };

export function CartDrawer(props: {
  slug: string;
  preorderPath: string;
  wholesale: boolean;
  clientName: string | null;
  range: { fromKey: string; toKey: string; days: number } | null;
  onRange: (range: { fromKey: string; toKey: string; days: number }) => void;
  lines: CartDrawerLine[];
  onQuantity: (id: string, next: number) => void;
  localSubtotal: number | null;
  /** Sin fechas: suma por día (o por evento) con los precios públicos; con fechas es null. */
  perDay: { sum: number; missing: number; unit: string } | null;
  view: CartView | null;
  showPrices: boolean;
  priceMode: PriceMode;
  zones: CatalogZoneView[];
  zoneChoice: string;
  onZone: (value: string) => void;
  done: Done | null;
  onDone: (done: Done) => void;
  onSent: () => void;
  onClose: () => void;
  onFinish: () => void;
  onSaveCart?: () => void;
}) {
  const { range, lines, localSubtotal, perDay, view, showPrices, done, zones, zoneChoice, priceMode } = props;
  const zone = zones.find((entry) => entry.id === zoneChoice) ?? null;
  const pieces = lines.reduce((sum, line) => sum + line.quantity, 0);
  // El subtotal local conserva el motor de productos; el flete sólo se informa tras revalidarlo el API.
  const subtotal = view ? view.itemsSubtotal : localSubtotal;
  const estimate = preorderEstimate(subtotal, view?.delivery);
  const fee = estimate.fee;
  const total = estimate.amount;
  const viewLines = new Map((view?.lines ?? []).map((line) => [line.id, line]));
  const unpriced = lines.some((line) => !viewLines.get(line.id)?.unitPrice);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [place, setPlace] = useState("");
  const [city, setCity] = useState("");
  const [department, setDepartment] = useState("");
  const [notes, setNotes] = useState("");
  const [step, setStep] = useState<1 | 2>(1);
  const [askPrice, setAskPrice] = useState(false);
  const [priceComment, setPriceComment] = useState("");
  const [priceAmount, setPriceAmount] = useState("");
  const [trap, setTrap] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const attempt = useRef<{ key: string; payload: string } | null>(null);
  const dialog = useRef<HTMLDivElement>(null);

  useModalBehavior(dialog, props.onClose);

  // El lugar del evento: dirección o referencia + ciudad y departamento (el departamento se completa al elegir la ciudad).
  const location = [place.trim(), city.trim(), department.trim()].filter(Boolean).join(", ");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!range) { setError("Elegí la fecha del evento y los días antes de enviar la preorden."); return; }
    if (location.length < 2) { setError("Contanos dónde es el evento: ciudad o dirección."); return; }
    const amount = askPrice ? parsePriceAmount(priceAmount.trim()) : null;
    if (askPrice && priceComment.trim().length < 3) { setError("Contanos por qué pedís un mejor precio (al menos 3 caracteres)."); return; }
    if (amount === "invalid") { setError("El monto que querés pagar tiene que ser un número entero en guaraníes."); return; }
    setError("");
    const payload = {
      name, phone, email, location, notes,
      from: range.fromKey, to: range.toKey,
      items: lines.map((line) => ({ inventoryId: line.id, quantity: line.quantity })),
      ...(zone ? { deliveryZoneId: zone.id } : zoneChoice === "COORDINATE" ? { deliveryCoordinate: true } : {}),
      // El monto deseado es solo un pedido: la empresa lo acepta, lo contraoferta o lo rechaza; nunca se aplica solo.
      ...(askPrice ? { priceRequest: { comment: priceComment.trim(), desiredAmount: amount } } : {}),
      website: trap,
    };
    const serialized = JSON.stringify(payload);
    // La misma clave solo se reutiliza para reenviar EXACTAMENTE el mismo pedido.
    if (!attempt.current || attempt.current.payload !== serialized) attempt.current = { key: crypto.randomUUID(), payload: serialized };
    setBusy(true);
    try {
      const response = await fetch(props.preorderPath, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": attempt.current.key },
        body: serialized,
      });
      const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (response.status === 429) { setError("Hiciste muchos intentos seguidos. Esperá unos minutos y volvé a probar."); return; }
      if (!response.ok) { setError(typeof data.error === "string" && data.error !== "Invalid request." ? data.error : "Revisá tus datos: algún campo no es válido."); return; }
      if (data.simulated === true) { props.onDone({ kind: "simulated", message: String(data.message ?? "Esto es una demo: no se guardó nada.") }); return; }
      const preorder = data.preorder as { respondBy: string; trackingPath: string; whatsappUrl: string | null };
      props.onDone({ kind: "saved", respondBy: preorder.respondBy, trackingPath: preorder.trackingPath, whatsappUrl: preorder.whatsappUrl, priceRequested: askPrice });
      props.onSent();
    } catch (failure) {
      console.error("tienda: no se pudo enviar el pedido", failure);
      setError("No pudimos enviar el pedido. Revisá tu conexión y reintentá: no se duplica.");
    } finally {
      setBusy(false);
    }
  }

  const stepOneReady = Boolean(range) && lines.length > 0;
  const priceOk = !askPrice || priceComment.trim().length >= 3;
  const perDayText = !range && perDay ? `${formatGs(perDay.sum)} ${perDay.unit}${perDay.missing > 0 ? " + otros por cotizar" : ""}` : null;

  return (
    <div className="cp-overlay cp-overlay--drawer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) props.onClose(); }}>
      <div className="cp-drawer" role="dialog" aria-modal="true" aria-labelledby="pedido-titulo" ref={dialog} tabIndex={-1} data-testid="cart-drawer">
        {done ? (
          <>
            <header className="cp-drawer-head">
              <h2 id="pedido-titulo" className="cp-drawer-title">{done.kind === "saved" ? PREORDER_COPY.received : "Demo: no se guardó nada"}</h2>
              <button type="button" className="cp-btn cp-btn--icon cp-btn--ghost" onClick={props.onFinish} aria-label="Cerrar"><XIcon name="close" size={20} /></button>
            </header>
            <div className="cp-drawer-body cp-done" data-testid="preorder-done">
              {done.kind === "saved" ? (
                <>
                  <p>
                    <strong>{PREORDER_COPY.notice}</strong> Te respondemos antes de{" "}
                    <strong>{respondFormat.format(new Date(done.respondBy))}</strong>.
                  </p>
                  <p className="cp-hint">{PREORDER_COPY.logistics}</p>
                  {done.priceRequested ? <p>Pediste un mejor precio: la empresa te responde en tu seguimiento. Nada cambia hasta que apruebes la versión final.</p> : null}
                  <p className="cp-hint">Podés seguirlo en cualquier momento con este link (guardalo):</p>
                  <p><a className="cp-link cp-wrap" href={done.trackingPath}>{done.trackingPath}</a></p>
                  {done.whatsappUrl ? (
                    <a className="cp-btn cp-btn--primary" href={done.whatsappUrl} target="_blank" rel="noopener noreferrer">
                      Enviar el resumen por WhatsApp
                    </a>
                  ) : null}
                </>
              ) : (
                <p>{done.message}</p>
              )}
            </div>
            <footer className="cp-drawer-foot"><button type="button" className="cp-btn" onClick={props.onFinish}>Cerrar</button></footer>
          </>
        ) : (
          <form onSubmit={step === 2 ? submit : (event) => { event.preventDefault(); if (stepOneReady && priceOk) { setError(""); setStep(2); } else if (!priceOk) setError("Contanos por qué pedís un mejor precio (al menos 3 caracteres)."); }} className="cp-drawer-form" noValidate={false}>
            <header className="cp-drawer-head">
              <div>
                <h2 id="pedido-titulo" className="cp-drawer-title">{step === 1 ? `${props.wholesale ? "Tu preorden mayorista" : PREORDER_COPY.title} (${pieces})` : "Datos para cotizar"}</h2>
                {step === 1 ? <p className="cp-hint cp-num" data-testid="cart-count">{lines.length} {lines.length === 1 ? "producto" : "productos"} · {pieces} {pieces === 1 ? "unidad" : "unidades"}</p> : null}
                {props.wholesale && props.clientName ? <p className="cp-hint">A nombre de {props.clientName}</p> : null}
              </div>
              <button type="button" className="cp-btn cp-btn--icon cp-btn--ghost" onClick={props.onClose} aria-label="Cerrar la preorden"><XIcon name="close" size={20} /></button>
            </header>
            <div className="cp-drawer-body">
              {step === 1 ? (
                <>
                  <div data-testid="cart-range">
                    <EventPicker slug={props.slug} range={range} variant="drawer" onApply={props.onRange} title="Fecha del evento" emptyNote="Elegí la fecha del evento y los días para ver el total y la disponibilidad." />
                  </div>
                  <ul className="cp-cart-lines" aria-label="Productos de la preorden">
                    {lines.map((line) => {
                      const priced = viewLines.get(line.id);
                      const fixed = priced?.mode === "TOTAL" || priced?.mode === "EVENT";
                      return (
                        <li key={line.id} className="cp-cart-line" data-testid="cart-line">
                          <span className="cp-cart-thumb" aria-hidden="true">
                            {line.imageUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={line.imageUrl} alt="" loading="lazy" />
                            ) : (
                              <ProductPlaceholder size={24} />
                            )}
                          </span>
                          <span className="cp-cart-info">
                            <strong className="cp-cart-name">{line.name}</strong>
                            {line.sku ? <span className="cp-cart-cod">{skuLabel(line.sku)}</span> : null}
                            <span className="cp-cart-row">
                              <Stepper label={line.name} value={line.quantity} step={line.step} min={0} onChange={(next) => { if (next <= 0 && lines.length === 1) props.onClose(); props.onQuantity(line.id, next); }} />
                              {showPrices && priced?.subtotal ? <span className="cp-cart-sub" data-testid="cart-line-subtotal">{formatGs(priced.subtotal)}</span> : null}
                            </span>
                            {showPrices && priced?.unitPrice ? (
                              <span className="cp-cart-price">
                                {formatGs(priced.unitPrice)} {priceUnitLabel(priceMode, priced.mode, range?.days ?? null)}
                                {!fixed && range && priced.mode !== "EVENT" ? ` × ${range.days} ${range.days === 1 ? "día" : "días"}` : ""}
                                {line.quantity > 1 ? ` × ${line.quantity}` : ""}
                              </span>
                            ) : null}
                            {!priced?.unitPrice ? <span className="cp-cart-price">{PREORDER_COPY.consult}</span> : null}
                            {priced?.tier ? <span className="cp-chip cp-tier-chip">Escalón {priced.tier}</span> : null}
                            {priced?.availability === "CONSULT" ? <span className="cp-chip cp-chip--muted">Consultar disponibilidad</span> : null}
                            {line.pieces ? <details className="cp-includes"><summary>Incluye</summary><p className="cp-hint">{line.pieces}</p></details> : null}
                            <button type="button" className="cp-linkbtn cp-cart-remove" onClick={() => { if (lines.length === 1) props.onClose(); props.onQuantity(line.id, 0); }} aria-label={`Quitar ${line.name} del pedido`}>Quitar</button>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                  {zones.length > 0 ? (
                    <div className="cp-fields">
                      <SelectField label="Flete (opcional)" size="full" value={zoneChoice} onChange={props.onZone}
                        options={[{ value: "", label: "Lo defino después" }, ...zones.map((entry) => ({ value: entry.id, label: `${entry.name}${showPrices && entry.basePrice > 0 ? ` · ${formatGs(entry.basePrice)}` : ""}` })), { value: "COORDINATE", label: "A coordinar" }]}
                        hint={zone && showPrices && fee !== null
                          ? `Flete estimado ${formatGs(fee)}${deliveryExtraApplies(zone, pieces) ? ` (incluye recargo por más de ${zone.volumeThreshold} piezas)` : zone.volumeThreshold !== null && zone.extraPrice ? ` (${deliveryRateText(zone).split(" + ")[1] ?? ""})` : ""}`
                          : zoneChoice === "COORDINATE" ? "Coordinamos el flete con vos al responder." : "Elegí una zona para consultar el flete; se suma sólo cuando recibimos su importe."} />
                    </div>
                  ) : null}
                  {showPrices ? (
                    <dl className="cp-summary" data-testid="cart-summary" aria-label="Resumen de la preorden">
                      {view && view.tierSavings > 0 && subtotal !== null ? (
                        <>
                          <div><dt>Subtotal a precio de lista</dt><dd>{formatGs(subtotal + view.tierSavings)}</dd></div>
                          <div><dt>Descuento por escalón de días</dt><dd className="cp-num--ok">− {formatGs(view.tierSavings)}</dd></div>
                        </>
                      ) : null}
                      {range && fee !== null ? (
                        <div><dt>Subtotal de productos</dt><dd>{subtotal !== null ? formatGs(subtotal) : "A cotizar"}</dd></div>
                      ) : perDayText ? (
                        <div><dt>Productos sin fechas</dt><dd>{perDayText}</dd></div>
                      ) : null}
                      <div><dt>Flete</dt><dd>{fee !== null ? formatGs(fee) : "A cotizar"}</dd></div>
                      {range && total !== null ? (
                        <div className="cp-summary-total" data-testid="cart-total"><dt>{estimate.label}</dt><dd>{formatGs(total)}</dd></div>
                      ) : null}
                    </dl>
                  ) : null}
                  {showPrices ? (
                    <p className="cp-hint">
                      {!range ? "Elegí las fechas para estimar los productos." : total !== null ? "Importes de referencia, sujetos a cotización." : PREORDER_COPY.consult}
                      {estimate.logisticsPending ? ` ${PREORDER_COPY.logistics}` : " Los servicios no detallados se cotizan aparte, si corresponden."}
                      {unpriced && view ? " Los productos sin precio cargado también se confirman en la cotización." : ""}
                    </p>
                  ) : <p className="cp-hint">{PREORDER_COPY.consult}. {PREORDER_COPY.logistics}</p>}
                  <p className="cp-hint">{PREORDER_COPY.notice}</p>
                  {showPrices ? (
                    <div className="cp-price-ask" data-testid="price-ask">
                      <label className="cp-check">
                        <input type="checkbox" checked={askPrice} onChange={(e) => setAskPrice(e.target.checked)} aria-controls="mejor-precio" />
                        <span>Pedir un mejor precio</span>
                      </label>
                      {askPrice ? (
                        <div id="mejor-precio" className="cp-price-ask-fields cp-fields">
                          <TextAreaField label="¿Por qué lo pedís?" size="full" value={priceComment} onChange={setPriceComment} maxLength={PRICE_COMMENT_MAX} rows={2} required placeholder="Ej.: somos clientes frecuentes" />
                          <MoneyField label="Monto que proponés (opcional)" size="full" value={priceAmount} onChange={setPriceAmount} limit={PRICE_AMOUNT_MAX} placeholder="Ej.: 1.200.000" />
                          <p className="cp-hint">Es solo un pedido: la empresa te responde con su propuesta y el precio no cambia hasta que apruebes la versión final.</p>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </>
              ) : (
                <>
                  <p className="cp-hint">{PREORDER_COPY.notice} Revisamos disponibilidad, precio y logística antes de enviarte una cotización.</p>
                  <dl className="cp-summary" aria-label="Resumen antes de enviar">
                    <div><dt>{lines.length} {lines.length === 1 ? "producto" : "productos"} · {pieces} {pieces === 1 ? "unidad" : "unidades"}</dt><dd>{showPrices && total !== null ? `${estimate.label}: ${formatGs(total)}` : PREORDER_COPY.consult}</dd></div>
                    {estimate.logisticsPending ? <div><dt>Logística</dt><dd>A cotizar</dd></div> : null}
                  </dl>
                  <div className="cp-fields cp-fields-grid" data-testid="cart-fields">
                    <TextField label="Nombre y apellido" required value={name} onChange={setName} minLength={2} maxLength={120} autoComplete="name" autoFocus />
                    <PhoneField label="WhatsApp" required value={phone} onChange={setPhone} />
                    <EmailField label="Correo" required value={email} onChange={setEmail} />
                    <CityField label="Ciudad" required value={city} onChange={setCity} onSelect={(selected, dept) => { setCity(selected); setDepartment(dept); }} />
                    <TextField label="Lugar del evento" required={!city.trim()} value={place} onChange={setPlace} maxLength={160} autoComplete="street-address" placeholder="Dirección, salón o referencia" hint={department ? `Departamento: ${department}` : undefined} />
                    <TextAreaField label="Comentarios" optional wide value={notes} onChange={setNotes} maxLength={1000} rows={3} />
                  </div>
                  <input className="cp-trap" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" value={trap} onChange={(e) => setTrap(e.target.value)} />
                  <p className="cp-legal">Al enviar aceptás que usemos estos datos solo para responder tu preorden.</p>
                </>
              )}
              {error ? <p className="cp-error" role="alert">{error}</p> : null}
            </div>
            <footer className="cp-drawer-foot">
              {props.onSaveCart ? <button type="button" className="cp-btn cp-btn--ghost cp-save-cart" onClick={props.onSaveCart}>Guardar carrito para después</button> : null}
              <div className="cp-cart-actions">
                {step === 2 ? <button type="button" className="cp-btn" onClick={() => setStep(1)}>Volver</button> : <button type="button" className="cp-btn" onClick={props.onClose}>Seguir eligiendo</button>}
                {step === 1 ? (
                  <button type="submit" className="cp-btn cp-btn--primary" disabled={!stepOneReady} title={!range ? "Elegí las fechas del evento para continuar" : undefined}>Continuar con tus datos</button>
                ) : (
                  <button type="submit" className="cp-btn cp-btn--primary" disabled={busy || !range}>{busy ? "Enviando…" : PREORDER_COPY.send}</button>
                )}
              </div>
            </footer>
          </form>
        )}
      </div>
    </div>
  );
}
