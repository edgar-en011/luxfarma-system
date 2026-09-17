/**
 * Logo LUXFARMA: cruz hueca redondeada en badge con gradiente + wordmark serif.
 * variant: "full" | "icon"
 * color: "white" | "red"
 */
function CrossSvg({ size, fill }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      style={{ display: 'block', position: 'relative', flexShrink: 0 }}
    >
      <path
        fill={fill}
        fillRule="evenodd"
        d="M26.5 7c0-2.5 2-4.5 4.5-4.5h2c2.5 0 4.5 2 4.5 4.5v14.5H52c2.5 0 4.5 2 4.5 4.5v2c0 2.5-2 4.5-4.5 4.5H37.5V57c0 2.5-2 4.5-4.5 4.5h-2c-2.5 0-4.5-2-4.5-4.5V37.5H12c-2.5 0-4.5-2-4.5-4.5v-2c0-2.5 2-4.5 4.5-4.5h14.5V7zm5 6.5h1v16h16v1h-16v16h-1v-16h-16v-1h16v-16z"
      />
    </svg>
  );
}

export default function LogoLuxFarma({
  variant = 'full',
  size = 40,
  color = 'white',
  className = '',
  title = 'LuxFarma',
  showSubtitle = false,
  showBadge = true,
}) {
  const onLight = color === 'red';
  const paint = onLight ? 'var(--lf-primary, #E11D2E)' : '#FFFFFF';
  const badgeSize = Math.round(Number(size) || 40);
  const cross = Math.max(16, Math.round(badgeSize * (showBadge ? 0.58 : 1)));
  const fontPx = Math.max(16, Math.round(badgeSize * 0.55));
  const radius = Math.max(8, Math.round(badgeSize * 0.28));

  return (
    <span
      className={`lf-logo lf-logo-${variant} ${className}`.trim()}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: variant === 'full' ? Math.max(10, Math.round(badgeSize * 0.28)) : 0,
        lineHeight: 1,
        color: paint,
      }}
      role="img"
      aria-label={title}
    >
      {showBadge ? (
        <span
          className="lf-logo-badge"
          style={{
            width: badgeSize,
            height: badgeSize,
            borderRadius: radius,
            background: 'var(--lf-gradient-brand, linear-gradient(135deg, #F0313F, #E11D2E 50%, #C8102E))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            boxShadow: '0 4px 14px rgb(225 29 46 / 0.28), inset 0 1px 0 rgb(255 255 255 / 0.28)',
            position: 'relative',
          }}
        >
          <span
            aria-hidden="true"
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: 'inherit',
              background: 'linear-gradient(160deg, rgb(255 255 255 / 0.28) 0%, transparent 48%)',
              pointerEvents: 'none',
            }}
          />
          <CrossSvg size={cross} fill="#FFFFFF" />
        </span>
      ) : (
        <CrossSvg size={cross} fill={onLight ? 'var(--lf-primary, #E11D2E)' : '#FFFFFF'} />
      )}
      {variant === 'full' && (
        <span style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
          <span
            className="lf-brand-font"
            style={{
              fontFamily: "var(--lf-font-brand, 'Zilla Slab', Georgia, serif)",
              fontWeight: 700,
              fontSize: fontPx,
              letterSpacing: '-0.03em',
              color: 'inherit',
              whiteSpace: 'nowrap',
              lineHeight: 1,
            }}
          >
            LuxFarma
          </span>
          {showSubtitle && (
            <span
              style={{
                fontSize: Math.max(8, Math.round(fontPx * 0.38)),
                fontWeight: 700,
                letterSpacing: '0.22em',
                textTransform: 'uppercase',
                color: onLight ? 'var(--lf-text-muted)' : 'rgb(255 255 255 / 0.72)',
                fontFamily: 'system-ui, sans-serif',
              }}
            >
              Farmacia
            </span>
          )}
        </span>
      )}
    </span>
  );
}
