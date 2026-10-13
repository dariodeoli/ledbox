/** Esqueleto de un gráfico mientras carga: barras fantasma con el mismo alto que el real. */
export function ChartSkeleton({ label = "Cargando gráfico", height = 210 }: { label?: string; height?: number }) {
  const bars = [42, 64, 38, 80, 56, 70, 48, 60];
  return (
    <div className="admin-chart-skeleton" role="status" aria-label={label} style={{ height }}>
      {bars.map((percent, index) => (
        <span key={index} className="admin-chart-skeleton-bar" style={{ height: `${percent}%` }} />
      ))}
    </div>
  );
}
