# CONTSERTRIB v9.9.89 — Correcciones SRI de documentos

Cambios aplicados sin eliminar módulos existentes:

1. **Liquidación de compra**
   - Normalización defensiva de cada detalle antes de construir el XML.
   - Si la descripción viene vacía, se utiliza `Bien o servicio adquirido`.
   - La descripción se limita a 300 caracteres y el código principal a 25 caracteres.
   - El formulario exige descripción y limita visualmente a 300 caracteres.
   - Esto evita el preflight `descripcion vacía o supera 300 caracteres`.

2. **Guía de remisión**
   - Se añadieron al formulario tipo de identificación y código de establecimiento del destinatario.
   - Se añadió correo del transportista.
   - Se conservan origen, destino, ruta, fechas, placa, sustento, documento aduanero, remitente y bienes.
   - Los detalles se normalizan con descripción y código válidos antes del XML.

3. **Comprobante de retención**
   - Se incorporó catálogo SRI 2026 de conceptos de Renta e IVA de uso frecuente.
   - Al seleccionar el concepto, el código y porcentaje quedan determinados por el catálogo.
   - El valor retenido se calcula automáticamente como base × porcentaje / 100.
   - El backend vuelve a calcular y valida código, porcentaje y valor antes de firmar.
   - Vigencia de los nuevos porcentajes de Renta: desde 1 de marzo de 2026, conforme NAC-DGERCGC26-00000009.

4. **Pantalla Emitir comprobantes**
   - Se mantiene el workspace de pantalla completa existente.
   - En escritorio se bloquea el scroll global de la página y se usa scroll interno por panel/tablas.
   - Las acciones permanecen visibles; no es necesario bajar hasta el final de toda la página para operar.
   - En móvil se conserva comportamiento responsive con scroll normal.

5. **No se modificó Supabase ni se eliminaron funcionalidades existentes.**

Validación realizada: sintaxis JavaScript de `public/documentos.html` correcta con Node local. No se ejecutó el build TypeScript completo local porque el entorno de trabajo dispone de Node 22 y el proyecto requiere Node >=24.18; Railway utiliza Node 24.20.0 según el último log proporcionado.
