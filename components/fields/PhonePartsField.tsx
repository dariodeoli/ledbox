"use client";

import { CODIGOS_PAIS, Input, Select, soloDigitos } from "owncoding-ui";

/** Split phone adapter for public enquiries, including Paraguayan landlines.
 * PhoneField's mobile-only validation is incompatible with this endpoint (owncoding-ui#4).
 * Reuse the library's country catalogue, digits helper and control primitives; no local mask.
 * `name` intentionally submits the national part, matching the existing lead form contract.
 */
export function PhonePartsField({ countryCode, phone, onCountryCodeChange, onChange, name, required, disabled }: {
  countryCode: string; phone: string; onCountryCodeChange: (value: string) => void;
  onChange: (value: string) => void; name?: string; required?: boolean; disabled?: boolean;
}) {
  return <span className="lead-phone-row">
    <span className="lead-phone-code"><Select value={countryCode} onChange={(event) => onCountryCodeChange(event.target.value)} aria-label="Código de país" autoComplete="tel-country-code" disabled={disabled}>
      {CODIGOS_PAIS.map((code) => <option key={code} value={code}>{code}</option>)}
    </Select></span>
    <Input name={name} type="tel" inputMode="tel" required={required} autoComplete="tel-national" value={phone} onChange={(event) => onChange(soloDigitos(event.target.value))} placeholder="981 123 456" aria-label="Teléfono" disabled={disabled} />
  </span>;
}
