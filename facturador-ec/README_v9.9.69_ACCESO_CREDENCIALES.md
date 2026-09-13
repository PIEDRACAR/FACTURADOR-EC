# v9.9.69 — Acceso y credenciales de nuevas empresas

Corrección del flujo de alta/login sin eliminar funciones.

## Correcciones
- El login usa `SUPABASE_ANON_KEY`/`SUPABASE_PUBLISHABLE_KEY` cuando está configurada.
- El alta de una empresa crea las credenciales realmente en Supabase Auth.
- Si el correo ya existe en Auth pero aún no pertenece a un negocio, se establece la contraseña indicada durante el alta.
- Si el correo ya pertenece a otra empresa, el alta se detiene con un mensaje claro para evitar cambiar la contraseña de un usuario existente.
- ROOT mantiene su flujo independiente.

## Railway
Recomendado: configurar `SUPABASE_ANON_KEY` con la clave pública/anon de Supabase. No reemplazar `SUPABASE_SERVICE_ROLE_KEY`; ambas cumplen funciones diferentes.
