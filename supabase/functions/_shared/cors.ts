const HEADERS_PERMITIDOS = 'authorization, x-client-info, apikey, content-type, x-luxfarma-ai-session';

export function corsPara(request: Request) {
  const origin = request.headers.get('origin') || '';
  const configurados = (Deno.env.get('AI_ALLOWED_ORIGINS') || '')
    .split(',')
    .map((valor) => valor.trim())
    .filter(Boolean);
  const aceptaTodos = configurados.length === 0 || configurados.includes('*');
  const permitido = !origin || aceptaTodos || configurados.includes(origin);
  const allowOrigin = aceptaTodos ? '*' : (permitido ? origin : 'null');

  return {
    permitido,
    headers: {
      'Access-Control-Allow-Origin': allowOrigin,
      'Access-Control-Allow-Headers': HEADERS_PERMITIDOS,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin',
    },
  };
}
