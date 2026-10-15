/** Selector de cantidad compacto (−, cantidad, +) con áreas táctiles de 44 px. `step` sube y baja de a 10 en las piezas «c/u». */
export function Stepper({ label, value, step = 1, min = 0, max = 99, onChange }: { label: string; value: number; step?: number; min?: number; max?: number; onChange: (next: number) => void }) {
  return (
    <div className="cp-stepper" role="group" aria-label={`Cantidad de ${label}`}>
      <button type="button" disabled={value <= min} onClick={() => onChange(Math.max(min, value - step))} aria-label={`Quitar ${step === 1 ? "una unidad" : `${step} unidades`}`}>−</button>
      <output aria-live="polite">{value}</output>
      <button type="button" disabled={value >= max} onClick={() => onChange(Math.min(max, value + step))} aria-label={`Agregar ${step === 1 ? "una unidad" : `${step} unidades`}`}>+</button>
    </div>
  );
}
