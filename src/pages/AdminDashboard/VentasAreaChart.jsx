import { useMemo, useState } from 'react';
import './VentasAreaChart.css';

const PAD = { top: 16, right: 10, bottom: 30, left: 48 };
const H = 210;
const W = 720; // viewBox; un poco más ancho para 24 horas sin aplastar

function niceMax(raw) {
  if (!raw || raw <= 0) return 100;
  const exp = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / exp;
  const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return nice * exp;
}

function formatSoles(n) {
  return `S/ ${Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Gráfico de área/línea SVG (sin librería externa).
 * puntos: [{ label: '12am'|'3pm'|'Lun'|1, valor: number }]
 */
export default function VentasAreaChart({ puntos = [] }) {
  const [hoverIdx, setHoverIdx] = useState(null);

  const hayVentas = useMemo(
    () => (puntos || []).some((p) => Number(p.valor) > 0),
    [puntos]
  );

  const { pathLine, pathArea, coords, yTicks, innerW, innerH } = useMemo(() => {
    const vals = (puntos || []).map((p) => Number(p.valor) || 0);
    const maxY = niceMax(Math.max(...vals, 0));
    const innerW = W - PAD.left - PAD.right;
    const innerH = H - PAD.top - PAD.bottom;
    const n = Math.max(vals.length, 1);
    const stepX = n <= 1 ? 0 : innerW / (n - 1);

    const coords = vals.map((v, i) => {
      const x = PAD.left + (n <= 1 ? innerW / 2 : i * stepX);
      const y = PAD.top + innerH - (maxY > 0 ? (v / maxY) * innerH : 0);
      return { x, y, v, label: puntos[i]?.label ?? String(i) };
    });

    const line = coords.map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x.toFixed(2)} ${c.y.toFixed(2)}`).join(' ');
    const area = coords.length
      ? `${line} L ${coords[coords.length - 1].x.toFixed(2)} ${(PAD.top + innerH).toFixed(2)} L ${coords[0].x.toFixed(2)} ${(PAD.top + innerH).toFixed(2)} Z`
      : '';

    const yTicks = [maxY, maxY / 2, 0].map((val, i) => ({
      val,
      y: PAD.top + (innerH * i) / 2,
    }));

    return { pathLine: line, pathArea: area, coords, yTicks, innerW, innerH, maxY };
  }, [puntos]);

  if (!hayVentas) {
    return (
      <div className="vac-chart vac-chart-empty">
        <svg className="vac-empty-icon" viewBox="0 0 48 32" aria-hidden>
          <path d="M2 26 L14 18 L22 22 L34 10 L46 16" fill="none" stroke="#012B63" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.35" />
          <path d="M2 26 L14 18 L22 22 L34 10 L46 16 L46 30 L2 30 Z" fill="#012B63" opacity="0.08" />
        </svg>
        <p className="vac-empty-title">Aún no hay ventas registradas en este período</p>
        <p className="vac-empty-sub">Cuando se registren ventas, verás aquí la curva por hora o por día.</p>
      </div>
    );
  }

  const tip = hoverIdx != null ? coords[hoverIdx] : null;

  // Etiquetas X: día (24 pts) → cada 3h (12am/3am/…); mes largo → cada 2; resto todas
  const xLabelStep = coords.length >= 24 ? 3 : coords.length > 16 ? 2 : 1;

  return (
    <div className="vac-chart">
      <svg
        className="vac-svg"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Gráfico de ventas"
        onMouseLeave={() => setHoverIdx(null)}
      >
        <defs>
          <linearGradient id="vacAreaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#012B63" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#012B63" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {/* Grid horizontal */}
        {yTicks.map((t, i) => (
          <g key={`yt-${i}`}>
            <line
              x1={PAD.left}
              x2={PAD.left + innerW}
              y1={t.y}
              y2={t.y}
              className="vac-grid-line"
            />
            <text x={PAD.left - 8} y={t.y + 3} textAnchor="end" className="vac-axis-label">
              S/ {t.val.toLocaleString('es-PE', { maximumFractionDigits: 0 })}
            </text>
          </g>
        ))}

        {/* Área + línea */}
        <path d={pathArea} fill="url(#vacAreaGrad)" />
        <path d={pathLine} className="vac-line" fill="none" />

        {/* Zonas hover + dots */}
        {coords.map((c, i) => {
          const bandW = coords.length > 1
            ? (innerW / (coords.length - 1))
            : innerW;
          return (
            <g key={`pt-${i}`}>
              <rect
                x={c.x - bandW / 2}
                y={PAD.top}
                width={bandW}
                height={innerH}
                fill="transparent"
                onMouseEnter={() => setHoverIdx(i)}
              />
              <circle
                cx={c.x}
                cy={c.y}
                r={hoverIdx === i ? 5.5 : 3.2}
                className={`vac-dot ${hoverIdx === i ? 'is-active' : ''}`}
                onMouseEnter={() => setHoverIdx(i)}
              />
            </g>
          );
        })}

        {/* Labels X */}
        {coords.map((c, i) => (
          i % xLabelStep === 0 || i === coords.length - 1 ? (
            <text
              key={`xl-${i}`}
              x={c.x}
              y={H - 8}
              textAnchor="middle"
              className={`vac-axis-label vac-x-label ${hoverIdx === i ? 'is-active' : ''}`}
            >
              {c.label}
            </text>
          ) : null
        ))}

        {/* Tooltip */}
        {tip && (() => {
          const tipW = 118;
          const tipH = 44;
          let tipX = tip.x - tipW / 2;
          tipX = Math.max(PAD.left, Math.min(tipX, W - PAD.right - tipW));
          const tipY = Math.max(4, tip.y - tipH - 12);
          return (
            <g className="vac-tooltip" pointerEvents="none">
              <line x1={tip.x} x2={tip.x} y1={PAD.top} y2={PAD.top + innerH} className="vac-hover-line" />
              <rect x={tipX} y={tipY} width={tipW} height={tipH} rx="8" className="vac-tooltip-bg" />
              <text x={tipX + tipW / 2} y={tipY + 18} textAnchor="middle" className="vac-tooltip-label">
                {tip.label}
              </text>
              <text x={tipX + tipW / 2} y={tipY + 34} textAnchor="middle" className="vac-tooltip-value">
                {formatSoles(tip.v)}
              </text>
            </g>
          );
        })()}
      </svg>
    </div>
  );
}
