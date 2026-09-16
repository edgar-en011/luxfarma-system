/** Roles del sistema (tabla public.roles). */
export const ROL_DUENO = 1;
export const ROL_ADMIN = 2;
export const ROL_VENDEDOR = 3;
/** Misma operativa/permisos que Vendedor — solo etiqueta distinta. */
export const ROL_TECNICO = 4;

export function esAdmin(idRol) {
  return Number(idRol) === ROL_ADMIN;
}

/** Vendedor o Técnico(a) en Farmacia (mismo menú, POS, caja, etc.). */
export function esRolCaja(idRol) {
  const n = Number(idRol);
  return n === ROL_VENDEDOR || n === ROL_TECNICO;
}

/** Admin + personal de caja (listados de “quién vende / quién cuenta”). */
export function esRolOperativo(idRol) {
  return esAdmin(idRol) || esRolCaja(idRol);
}

export function labelRol(idRol, nombreDesdeBd = null) {
  if (nombreDesdeBd) return nombreDesdeBd;
  const n = Number(idRol);
  if (n === ROL_ADMIN) return 'Administrador';
  if (n === ROL_VENDEDOR) return 'Vendedor';
  if (n === ROL_TECNICO) return 'Técnico(a) en Farmacia';
  if (n === ROL_DUENO) return 'Dueño';
  return `Rol ${idRol}`;
}

/** Roles con acceso a rutas de caja / vendedor. */
export const ROLES_CAJA = [ROL_VENDEDOR, ROL_TECNICO];
export const ROLES_CAJA_Y_ADMIN = [ROL_ADMIN, ROL_VENDEDOR, ROL_TECNICO];

/** Comparación segura number/string para allowedRoles.includes. */
export function rolPermitido(idRol, allowedRoles) {
  if (!allowedRoles || allowedRoles.length === 0) return true;
  const n = Number(idRol);
  return allowedRoles.some((r) => Number(r) === n);
}
