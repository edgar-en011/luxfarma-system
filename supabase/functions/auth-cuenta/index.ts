import { createClient } from 'npm:@supabase/supabase-js@2';
import bcrypt from 'npm:bcryptjs@3.0.3';
import { corsPara } from '../_shared/cors.ts';

const corsJson = (request: Request, body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsPara(request).headers, 'Content-Type': 'application/json; charset=utf-8' },
});

function clients() {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('SERVER_CONFIG');
  return { admin: createClient(url, key, { auth: { persistSession: false } }), url, key };
}

function emailCuenta(id: number) { return `usuario-${id}@auth.luxfarma.local`; }

async function encontrarAuthUser(admin: ReturnType<typeof createClient>, email: string) {
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const user = data.users.find((item) => item.email === email);
    if (user) return user;
    if (data.users.length < 1000) break;
  }
  return null;
}

Deno.serve(async (request) => {
  const cors = corsPara(request);
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors.headers });
  if (!cors.permitido) return corsJson(request, { code: 'ORIGIN_NOT_ALLOWED' }, 403);
  if (request.method !== 'POST') return corsJson(request, { code: 'METHOD_NOT_ALLOWED' }, 405);
  try {
    const body = await request.json();
    const { admin, url, key } = clients();
    if (body.accion === 'buscar_recuperacion' || body.accion === 'crear_ticket_recuperacion') {
      const dni = String(body.dni || '').replace(/\D/g, '');
      if (!/^\d{8}$/.test(dni)) return corsJson(request, { code: 'INVALID_INPUT' }, 400);
      const { data: person } = await admin.from('usuarios')
        .select('id_usuario, dni, nombres, apellidos, id_sucursal, activo').eq('dni', dni).maybeSingle();
      if (!person || !lowerActive(person.activo)) return corsJson(request, { code: 'USER_NOT_FOUND' }, 404);
      if (body.accion === 'buscar_recuperacion') {
        return corsJson(request, { usuario: { id_usuario: person.id_usuario, dni: person.dni, nombres: person.nombres, apellidos: person.apellidos, id_sucursal: person.id_sucursal } });
      }
      const { data: ticket, error: ticketError } = await admin.from('tickets_soporte').insert({
        id_usuario: person.id_usuario, id_sucursal: person.id_sucursal,
        asunto: 'Recuperación de contraseña',
        descripcion: String(body.descripcion || 'El usuario solicita recuperación de contraseña.').slice(0, 2000),
        prioridad: 'Alta', tipo: 'Prob. Técnico', estado: 'PENDIENTE',
      }).select('id_ticket, asunto, prioridad, estado').single();
      if (ticketError) throw ticketError;
      return corsJson(request, { ok: true, ticket });
    }
    if (body.accion === 'reauth') {
      const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || '';
      const { data: authData, error: authError } = await admin.auth.getUser(token);
      if (authError || !authData.user) return corsJson(request, { code: 'SESSION_INVALID' }, 401);
      const { data: account } = await admin.from('usuarios').select('id_usuario, password_hash, activo')
        .eq('auth_user_id', authData.user.id).maybeSingle();
      const stored = String(account?.password_hash || '');
      const ok = account && lowerActive(account.activo) && (stored.startsWith('$2')
        ? await bcrypt.compare(String(body.password || ''), stored)
        : String(body.password || '') === stored);
      return ok ? corsJson(request, { ok: true }) : corsJson(request, { code: 'INVALID_CREDENTIALS' }, 401);
    }
    if (body.accion === 'cambiar_password') {
      const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || '';
      const { data: authData, error: authError } = await admin.auth.getUser(token);
      const actual = String(body.password_actual || '');
      const nueva = String(body.password_nueva || '');
      if (authError || !authData.user) return corsJson(request, { code: 'SESSION_INVALID' }, 401);
      if (nueva.length < 8 || nueva.length > 128) return corsJson(request, { code: 'INVALID_PASSWORD', message: 'La nueva contraseña debe tener entre 8 y 128 caracteres.' }, 400);
      const { data: account } = await admin.from('usuarios').select('id_usuario, password_hash, activo')
        .eq('auth_user_id', authData.user.id).maybeSingle();
      const stored = String(account?.password_hash || '');
      const valida = account && lowerActive(account.activo) && (stored.startsWith('$2')
        ? await bcrypt.compare(actual, stored)
        : actual === stored);
      if (!valida) return corsJson(request, { code: 'INVALID_CREDENTIALS', message: 'La contraseña actual es incorrecta.' }, 401);
      const hash = await bcrypt.hash(nueva, 12);
      const { error: updateError } = await admin.from('usuarios').update({ password_hash: hash }).eq('id_usuario', account.id_usuario);
      if (updateError) throw updateError;
      const { error: authUpdateError } = await admin.auth.admin.updateUserById(authData.user.id, { password: nueva });
      if (authUpdateError) throw authUpdateError;
      return corsJson(request, { ok: true });
    }
    if (body.accion !== 'login') return corsJson(request, { code: 'INVALID_ACTION' }, 400);
    const dni = String(body.dni || '').replace(/\D/g, '');
    const password = typeof body.password === 'string' ? body.password : '';
    if (!/^\d{8}$/.test(dni) || !password || password.length > 128) {
      return corsJson(request, { code: 'INVALID_CREDENTIALS', message: 'DNI o contraseña incorrectos.' }, 401);
    }

function lowerActive(value: unknown) {
  return value === true || value === 1 || value === '1' || String(value).toLowerCase() === 'true';
}
    const { data: account, error } = await admin.from('usuarios')
      .select('id_usuario, dni, nombres, apellidos, id_rol, id_sucursal, activo, password_hash, roles(nombre), sucursales(id_sucursal, nombre_comercial, direccion, ruc, telefono)')
      .eq('dni', dni).maybeSingle();
    const stored = String(account?.password_hash || '');
    const valid = !error && account && (stored.startsWith('$2')
      ? await bcrypt.compare(password, stored)
      : password === stored);
    if (!valid || !account.activo) return corsJson(request, { code: 'INVALID_CREDENTIALS', message: 'DNI o contraseña incorrectos.' }, 401);

    const authEmail = emailCuenta(Number(account.id_usuario));
    const { data: linked } = await admin.from('usuarios').select('auth_user_id').eq('id_usuario', account.id_usuario).maybeSingle();
    let authUser = linked?.auth_user_id ? await admin.auth.admin.getUserById(linked.auth_user_id).then((r) => r.data.user) : null;
    if (!authUser) authUser = await encontrarAuthUser(admin, authEmail);
    if (authUser) {
      const { data, error: updateError } = await admin.auth.admin.updateUserById(authUser.id, { password, email_confirm: true, user_metadata: { id_usuario: account.id_usuario } });
      if (updateError) throw updateError;
      authUser = data.user;
    } else {
      const { data, error: createError } = await admin.auth.admin.createUser({ email: authEmail, password, email_confirm: true, user_metadata: { id_usuario: account.id_usuario } });
      if (createError) throw createError;
      authUser = data.user;
    }
    const cambiosUsuario: Record<string, unknown> = { auth_user_id: authUser.id };
    if (!stored.startsWith('$2')) cambiosUsuario.password_hash = await bcrypt.hash(password, 12);
    const { error: linkError } = await admin.from('usuarios').update(cambiosUsuario).eq('id_usuario', account.id_usuario);
    if (linkError) throw linkError;

    const authClient = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: session, error: signInError } = await authClient.auth.signInWithPassword({ email: authEmail, password });
    if (signInError || !session.session) throw signInError || new Error('AUTH_SESSION_FAILED');
    const { password_hash: _secret, auth_user_id: _authId, ...profile } = account;
    return corsJson(request, { profile, session: session.session });
  } catch (error) {
    console.error('[auth-cuenta]', error);
    return corsJson(request, { code: 'AUTH_ERROR', message: 'No se pudo iniciar sesión en este momento.' }, 503);
  }
});
