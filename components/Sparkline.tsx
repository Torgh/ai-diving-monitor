/** A depth profile thumbnail: the surface on top, deeper downwards. Decoration; the numbers are beside it. */
export function Sparkline({ depths, width = 120, height = 40 }: { depths: number[]; width?: number; height?: number }) {
  if (depths.length < 2) return <svg width={width} height={height} aria-hidden="true" />;
  const max = Math.max(...depths, 1);
  const pad = 2;
  const x = (i: number) => (i / (depths.length - 1)) * width;
  const y = (d: number) => pad + (d / max) * (height - 2 * pad);
  const line = depths.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(d).toFixed(1)}`).join(" ");
  return (
    <svg className="sparkline" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <path d={`${line} L${width} ${pad} L0 ${pad} Z`} fill="var(--accent)" opacity="0.12" />
      <path d={line} fill="none" stroke="var(--accent)" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}
