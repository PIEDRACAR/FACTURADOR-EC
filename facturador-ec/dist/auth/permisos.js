import { supabase } from '../db/supabase.js';
export const CATALOGO_PERMISOS = [
    { clave: 'facturar', nombre: 'Facturación / POS', descripcion: 'Emitir facturas y consultar comprobantes.' },
    { clave: 'clientes', nombre: 'Clientes', descripcion: 'Consultar, crear y editar clientes.' },
    { clave: 'productos', nombre: 'Productos', descripcion: 'Administrar catálogo y precios.' },
    { clave: 'inventario', nombre: 'Inventario', descripcion: 'Kardex, movimientos y alertas de stock.' },
    { clave: 'proveedores', nombre: 'Proveedores', descripcion: 'Administrar proveedores y compras.' },
    { clave: 'caja', nombre: 'Caja', descripcion: 'Apertura, movimientos y cierre de caja.' },
    { clave: 'cxc', nombre: 'Cuentas por cobrar', descripcion: 'Gestionar cartera de clientes.' },
    { clave: 'cxp', nombre: 'Cuentas por pagar', descripcion: 'Gestionar obligaciones con proveedores.' },
    { clave: 'proformas', nombre: 'Proformas', descripcion: 'Crear y convertir proformas.' },
    { clave: 'reportes', nombre: 'Reportes', descripcion: 'Consultar y exportar reportes.' },
    { clave: 'correo', nombre: 'Correo electrónico', descripcion: 'Reenviar y administrar envíos.' },
    { clave: 'notificaciones', nombre: 'Notificaciones', descripcion: 'Ver y gestionar alertas del sistema.' },
    { clave: 'documentos', nombre: 'Notas y documentos', descripcion: 'Notas de crédito, débito, retenciones y guías.' },
    { clave: 'configuracion', nombre: 'Configuración', descripcion: 'Modificar parámetros del negocio y puntos de emisión.' },
    { clave: 'usuarios', nombre: 'Usuarios y permisos', descripcion: 'Crear usuarios y asignar permisos.' },
];
export function esPermiso(valor) {
    return CATALOGO_PERMISOS.some(x => x.clave === valor);
}
export const PERMISOS_POR_ROL = {
    admin: CATALOGO_PERMISOS.map(x => x.clave),
    contador: ['facturar', 'clientes', 'productos', 'inventario', 'proveedores', 'caja', 'cxc', 'cxp', 'proformas', 'reportes', 'correo', 'notificaciones', 'documentos', 'configuracion'],
    cajero: ['facturar', 'clientes', 'notificaciones', 'correo'],
};
export async function obtenerPermisosUsuario(userId, emisorId, rol) {
    if (rol === 'admin')
        return new Set(PERMISOS_POR_ROL.admin);
    const { data, error } = await supabase
        .from('usuarios_permisos')
        .select('permiso,activo')
        .eq('user_id', userId)
        .eq('emisor_id', emisorId)
        .eq('activo', true);
    if (!error && (data?.length ?? 0) > 0)
        return new Set((data ?? []).map(x => x.permiso));
    return new Set(PERMISOS_POR_ROL[rol] ?? []);
}
export async function guardarPermisosUsuario(userId, emisorId, permisos) {
    const unicos = [...new Set(permisos.filter(esPermiso))];
    const { error: delError } = await supabase.from('usuarios_permisos').delete().eq('user_id', userId).eq('emisor_id', emisorId);
    if (delError)
        throw new Error(delError.message);
    if (!unicos.length)
        return;
    const { error } = await supabase.from('usuarios_permisos').insert(unicos.map(permiso => ({ user_id: userId, emisor_id: emisorId, permiso, activo: true })));
    if (error)
        throw new Error(error.message);
}
export function permisoParaRuta(method, patron) {
    if (patron.startsWith('/pos') || patron.startsWith('/comprobantes'))
        return 'facturar';
    if (patron.startsWith('/clientes'))
        return 'clientes';
    if (patron.startsWith('/productos'))
        return 'productos';
    if (patron.startsWith('/inventario'))
        return 'inventario';
    if (patron.startsWith('/proveedores'))
        return 'proveedores';
    if (patron.startsWith('/caja'))
        return 'caja';
    if (patron.startsWith('/cuentas-por-cobrar'))
        return 'cxc';
    if (patron.startsWith('/cuentas-por-pagar'))
        return 'cxp';
    if (patron.startsWith('/proformas'))
        return 'proformas';
    if (patron.startsWith('/reportes') || patron.startsWith('/dashboard'))
        return 'reportes';
    if (patron.startsWith('/correo-prueba'))
        return 'correo';
    if (patron.startsWith('/notificaciones'))
        return 'notificaciones';
    if (patron.startsWith('/documentos') || patron.startsWith('/api/documentos'))
        return 'documentos';
    if (patron.startsWith('/configuracion'))
        return 'configuracion';
    if (patron.startsWith('/auth/usuarios'))
        return 'usuarios';
    return null;
}
//# sourceMappingURL=permisos.js.map