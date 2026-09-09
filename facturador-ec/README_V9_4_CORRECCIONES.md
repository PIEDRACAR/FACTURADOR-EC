# CONTSERTRIB FACTURACIÓN v9.4 — correcciones

- Campo de dirección del cliente visible y obligatorio en POS.
- Consulta de cliente primero busca por identificación en la base local; una cédula puede encontrarse aunque no tenga RUC.
- Si una cédula no tiene RUC consultable en SRI, el sistema lo informa sin inventar datos y permite completar nombre/dirección/correo.
- Autorización SRI ahora hace polling hasta 10 consultas antes de declarar que sigue en proceso; evita mostrar falsamente “no autorizado” cuando el SRI aún procesa.
- Mensaje del SRI se conserva en la respuesta cuando existe.
- Botones superiores de Notificaciones y Usuario rediseñados para escritorio y móvil, con menú de usuario funcional y centro de notificaciones legible.
