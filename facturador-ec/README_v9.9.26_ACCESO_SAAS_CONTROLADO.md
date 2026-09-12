# CONTSERTRIB v9.9.28 — Registro SaaS controlado y sesión persistente

## Registro público
- `/registro` ya no crea empresas, certificados, usuarios ni suscripciones activas.
- Solo registra una solicitud en `solicitudes_registro_saas`.
- El cliente nunca recibe sesión desde el registro público.
- No se solicitan ni almacenan `.p12`, contraseña de firma ni contraseña de acceso en la solicitud.

## Flujo recomendado
1. Cliente entra a `contsertrib.com/registro`.
2. Envía RUC, datos de contacto, plan de interés y ambiente.
3. ROOT revisa la solicitud en el Panel maestro.
4. ROOT pulsa **Cargar** y luego **Crear cliente y preparar acceso**.
5. CONTSERTRIB crea empresa, matriz 001, punto 001, usuario administrador y suscripción.
6. Se genera contraseña temporal y se puede enviar por correo.
7. Cliente entra y configura su firma electrónica, establecimientos, puntos, logo, correo, productos y demás parámetros.

## Seguridad multiempresa
El acceso operativo sigue dependiendo de `usuarios_emisor`; conocer un RUC o cambiar `emisorId` no concede acceso a otra empresa.

## Sesión
La sesión pasa a una duración persistente de larga duración y se renueva con actividad. El cierre normal del usuario se realiza mediante **Cerrar sesión**, que invalida la sesión en servidor y limpia la cookie.

> Nota de seguridad: una sesión que solo termina manualmente aumenta el riesgo si un equipo queda abierto o una cookie es comprometida. La aplicación conserva el control de suscripción y permisos en servidor.
