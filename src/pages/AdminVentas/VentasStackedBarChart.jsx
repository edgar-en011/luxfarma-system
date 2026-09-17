import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { formatHora12AmPm } from '../../utils/fechas';
import './AdminVentasExplorar.css';

function formatSoles(n) {
  return `S/ ${Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function hexToRgb(hex) {
  const raw = String(hex || 'var(--lf-primary-darker)').replace('#', '');
  const full = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw;
  const n = Number.parseInt(full, 16);
  if (Number.isNaN(n)) return { r: 198, g: 46, b: 58 };
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function mixRgb({ r, g, b }, toward, amount) {
  const m = (c, t) => Math.round(c + (t - c) * amount);
  return `rgb(${m(r, toward.r)}, ${m(g, toward.g)}, ${m(b, toward.b)})`;
}

function gradientStops(hex) {
  const base = hexToRgb(hex);
  return {
    top: mixRgb(base, { r: 0, g: 0, b: 0 }, 0.18),
    mid: `rgb(${base.r}, ${base.g}, ${base.b})`,
    bottom: mixRgb(base, { r: 255, g: 255, b: 255 }, 0.38),
    hover: mixRgb(base, { r: 0, g: 0, b: 0 }, 0.28),
  };
}

function TooltipHora({ active, payload, label, vendedores }) {
  if (!active || !payload?.length) return null;
  const filas = payload
    .filter((p) => Number(p.value) > 0)
    .map((p) => {
      const id = Number(String(p.dataKey).replace(/^v_/, ''));
      const vend = vendedores.find((v) => v.id === id);
      return { nombre: vend?.nombre || `Vendedor #${id}`, valor: Number(p.value), color: vend?.color || 'var(--lf-primary-darker)' };
    });
  const total = filas.reduce((s, f) => s + f.valor, 0);

  return (
    <div className="av-chart-tooltip">
      <p className="av-chart-tooltip-eyebrow">Hora</p>
      <p className="av-chart-tooltip-title">{label}</p>
      {total <= 0 ? (
        <p className="av-chart-tooltip-empty">Sin ventas en esta hora</p>
      ) : (
        <>
          <ul className="av-chart-tooltip-list">
            {filas.map((f) => (
              <li key={f.nombre} className="av-chart-tooltip-row">
                <span className="av-chart-tooltip-name">
                  <span className="av-chart-tooltip-dot" style={{ background: f.color }} />
                  {f.nombre}
                </span>
                <strong className="av-chart-tooltip-val">{formatSoles(f.valor)}</strong>
              </li>
            ))}
          </ul>
          <div className="av-chart-tooltip-total">
            <span>Total hora</span>
            <strong>{formatSoles(total)}</strong>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Barras apiladas por hora (0–23) y vendedor — gradiente, punta redondeada, hover.
 */
export default function VentasStackedBarChart({ data = [], vendedores = [] }) {
  const hayVentas = data.some((d) => Number(d.total) > 0);

  if (!hayVentas) {
    return (
      <div className="av-chart-empty">
        <p>Sin ventas en este día</p>
        <p style={{ margin: '4px 0 0', fontSize: 13 }}>El gráfico aparecerá cuando haya operaciones.</p>
      </div>
    );
  }

  const lastIdx = vendedores.length - 1;

  return (
    <div className="av-chart-shell">
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data} margin={{ top: 14, right: 12, left: 4, bottom: 6 }} barCategoryGap="22%">
          <defs>
            {vendedores.map((v) => {
              const g = gradientStops(v.color);
              return (
                <linearGradient key={v.id} id={`avBarGrad_${v.id}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={g.top} />
                  <stop offset="45%" stopColor={g.mid} />
                  <stop offset="100%" stopColor={g.bottom} />
                </linearGradient>
              );
            })}
            <filter id="avBarHoverShadow" x="-20%" y="-20%" width="140%" height="160%">
              <feDropShadow dx="0" dy="2" stdDeviation="2.5" floodColor="var(--lf-primary-darker)" floodOpacity="0.28" />
            </filter>
          </defs>
          <CartesianGrid
            strokeDasharray="0"
            stroke="var(--lf-border)"
            vertical={false}
            strokeOpacity={0.55}
          />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: 'var(--lf-text-muted)', fontWeight: 600 }}
            interval={2}
            tickFormatter={(v, i) => (i % 3 === 0 ? v : '')}
            axisLine={{ stroke: 'var(--lf-border)' }}
            tickLine={false}
            tickMargin={10}
            height={36}
          />
          <YAxis
            tick={{ fontSize: 11, fill: 'var(--lf-text-muted)', fontWeight: 600 }}
            tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v))}
            axisLine={false}
            tickLine={false}
            tickMargin={8}
            width={48}
          />
          <Tooltip
            content={<TooltipHora vendedores={vendedores} />}
            cursor={{ fill: 'rgba(225, 29, 46, 0.045)', radius: 6 }}
            wrapperStyle={{ outline: 'none' }}
          />
          {vendedores.map((v, idx) => {
            const isTop = idx === lastIdx;
            const g = gradientStops(v.color);
            return (
              <Bar
                key={v.id}
                dataKey={`v_${v.id}`}
                stackId="ventas"
                fill={`url(#avBarGrad_${v.id})`}
                name={v.nombre}
                maxBarSize={28}
                radius={isTop ? [8, 8, 0, 0] : [0, 0, 0, 0]}
                activeBar={{
                  fill: g.hover,
                  radius: isTop ? [8, 8, 0, 0] : [0, 0, 0, 0],
                  filter: 'url(#avBarHoverShadow)',
                }}
              />
            );
          })}
        </BarChart>
      </ResponsiveContainer>
      <p className="av-chart-caption">
        Eje en 12h · {formatHora12AmPm(0)} – {formatHora12AmPm(23)}
      </p>
    </div>
  );
}
