import { randomBytes } from 'node:crypto';
import { supabase } from '../db/supabase.js';
import { env } from '../config/env.js';

// Sesión persistente de larga duración: el usuario permanece autenticado mientras use
// el sistema y la termina explícitamente con «Cerrar sesión». No se aplica
// un cierre automático por inactividad en esta aplicación comercial.
const DURACION_SESION_DIAS = 3650;

export interface UsuarioAutenticado {
  userId: string;
  email: string;
}

/**
 * Verifica email+contraseña contra Supabase Auth (endpoint REST estándar
 * de "password grant"). Se hace desde el backend, no desde el navegador,
 * así el navegador nunca necesita ninguna llave de Supabase — coherente
 * con cómo ya se maneja cada otro secreto en este proyecto.
 */
export async function verificarCredenciales(email: string, password: string): Promise<UsuarioAutenticado> {
  const respuesta = await fetch(`${env.supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: env.supabaseAnonKey,
    },
    body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
  });

  if (!respuesta.ok) {
    throw new Error('Correo o contraseña incorrectos.');
  }

  const datos = (await respuesta.json()) as { user?: { id: string; email: string } };
  if (!datos.user) {
    throw new Error('No se pudo verificar el usuario.');
  }

  return { userId: datos.user.id, email: datos.user.email };
}

/**
 * Crea el usuario en Supabase Auth (vía la API de administración, con la
 * service role key — confirma el correo automáticamente, sin mandar email
 * de verificación, ya que quien registra el negocio es quien controla ese
 * correo). Si el correo ya existe, devuelve el usuario existente en vez de
 * fallar — útil para volver a registrar un negocio con el mismo dueño.
 */
export async function crearOEncontrarUsuario(email: string, password: string): Promise<string> {
  const creado = await fetch(`${env.supabaseUrl}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: env.supabaseServiceRoleKey,
      Authorization: `Bearer ${env.supabaseServiceRoleKey}`,
    },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });

  if (creado.ok) {
    const datos = (await creado.json()) as { id: string };
    return datos.id;
  }

  const busqueda = await fetch(`${env.supabaseUrl}/auth/v1/admin/users?email=${encodeURIComponent(email)}`, {
    headers: { apikey: env.supabaseServiceRoleKey, Authorization: `Bearer ${env.supabaseServiceRoleKey}` },
  });
  if (busqueda.ok) {
    const datos = (await busqueda.json()) as { users?: Array<{ id: string; email: string }> };
    const existente = datos.users?.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (existente) return existente.id;
  }

  const detalle = await creado.text();
  throw new Error(`No se pudo crear el usuario: ${detalle}`);
}

/**
 * Alta de credenciales para un nuevo negocio.
 * Si el correo ya existe pero todavía no pertenece a ningún negocio, se
 * sincroniza la contraseña solicitada por el registro. Si ya pertenece a
 * otro negocio, se rechaza para no cambiar silenciosamente la contraseña
 * de un usuario existente.
 */
export async function crearUsuarioParaAlta(email: string, password: string): Promise<{ userId: string; credencialesNuevas: boolean }> {
  const normalizado = email.trim().toLowerCase();
  const creado = await fetch(`${env.supabaseUrl}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: env.supabaseServiceRoleKey,
      Authorization: `Bearer ${env.supabaseServiceRoleKey}`,
    },
    body: JSON.stringify({ email: normalizado, password, email_confirm: true }),
  });
  if (creado.ok) {
    const datos = (await creado.json()) as { id: string };
    return { userId: datos.id, credencialesNuevas: true };
  }

  const busqueda = await fetch(`${env.supabaseUrl}/auth/v1/admin/users?email=${encodeURIComponent(normalizado)}`, {
    headers: { apikey: env.supabaseServiceRoleKey, Authorization: `Bearer ${env.supabaseServiceRoleKey}` },
  });
  if (!busqueda.ok) throw new Error(`No se pudo verificar si el correo ya existe en Auth.`);
  const datos = (await busqueda.json()) as { users?: Array<{ id: string; email: string }> };
  const existente = datos.users?.find((u) => u.email?.toLowerCase() === normalizado);
  if (!existente) {
    const detalle = await creado.text();
    throw new Error(`No se pudo crear el usuario: ${detalle}`);
  }

  const { data: negocios, error: negocioError } = await supabase
    .from('usuarios_emisor').select('emisor_id').eq('user_id', existente.id).limit(1);
  if (negocioError) throw new Error(`No se pudo comprobar el usuario existente: ${negocioError.message}`);
  if ((negocios ?? []).length > 0) {
    throw new Error('El correo ya está asociado a otra empresa de CONTSERTRIB. Usa otro correo para crear un nuevo administrador.');
  }

  const actualizado = await fetch(`${env.supabaseUrl}/auth/v1/admin/users/${existente.id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      apikey: env.supabaseServiceRoleKey,
      Authorization: `Bearer ${env.supabaseServiceRoleKey}`,
    },
    body: JSON.stringify({ password, email: normalizado, email_confirm: true }),
  });
  if (!actualizado.ok) {
    const detalle = await actualizado.text();
    throw new Error(`El usuario ya existe pero no se pudo establecer la nueva contraseña: ${detalle}`);
  }
  return { userId: existente.id, credencialesNuevas: true };
}

export async function crearSesion(userId: string): Promise<string> {
  const token = randomBytes(32).toString('hex');
  const expiraEn = new Date(Date.now() + DURACION_SESION_DIAS * 24 * 60 * 60 * 1000);

  const { error } = await supabase.from('sesiones').insert({ token, user_id: userId, expira_en: expiraEn.toISOString() });
  if (error) throw new Error(`No se pudo crear la sesión: ${error.message}`);

  return token;
}

export async function obtenerSesion(token: string): Promise<{ userId: string } | null> {
  const { data, error } = await supabase.from('sesiones').select('user_id, expira_en').eq('token', token).maybeSingle();
  if (error || !data) return null;

  if (new Date(data.expira_en) < new Date()) {
    await supabase.from('sesiones').delete().eq('token', token);
    return null;
  }

  const ahora = new Date(); const nuevaExpiracion = new Date(ahora.getTime() + DURACION_SESION_DIAS * 24 * 60 * 60 * 1000);
  void supabase.from('sesiones').update({ ultimo_uso: ahora.toISOString(), expira_en: nuevaExpiracion.toISOString() }).eq('token', token);

  return { userId: data.user_id };
}

export async function cerrarSesion(token: string): Promise<void> {
  await supabase.from('sesiones').delete().eq('token', token);
}

export interface NegocioDeUsuario {
  emisorId: string;
  razonSocial: string;
  nombreComercial: string | null;
  rol: string;
}

export async function obtenerNegociosDeUsuario(userId: string): Promise<NegocioDeUsuario[]> {
  const { data, error } = await supabase
    .from('usuarios_emisor')
    .select('rol, emisores(id, razon_social, nombre_comercial)')
    .eq('user_id', userId);

  if (error) throw new Error(error.message);

  return (data ?? [])
    .map((fila) => {
      const emisor = fila.emisores as unknown as { id: string; razon_social: string; nombre_comercial: string | null } | null;
      if (!emisor) return null;
      return { emisorId: emisor.id, razonSocial: emisor.razon_social, nombreComercial: emisor.nombre_comercial, rol: fila.rol as string };
    })
    .filter((x): x is NegocioDeUsuario => x !== null);
}

export async function obtenerRolEnNegocio(userId: string, emisorId: string): Promise<string | null> {
  const { data } = await supabase.from('usuarios_emisor').select('rol').eq('user_id', userId).eq('emisor_id', emisorId).maybeSingle();
  return data?.rol ?? null;
}

export async function agregarUsuarioANegocio(userId: string, emisorId: string, rol: string): Promise<void> {
  const { error } = await supabase.from('usuarios_emisor').upsert({ user_id: userId, emisor_id: emisorId, rol }, { onConflict: 'user_id,emisor_id' });
  if (error) throw new Error(error.message);
}
