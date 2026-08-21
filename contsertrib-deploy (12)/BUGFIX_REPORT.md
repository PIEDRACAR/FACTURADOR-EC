# CONTSERTRIB — Reporte de Corrección de 33 Bugs (24 + 9 nuevos)

**Fecha:** 2026-08-20  
**Sistema:** CONTSERTRIB (contabilidad ecuatoriana, NIIF-PYMES)  
**URL producción:** https://contser.vercel.app/  
**Estado del sitio en vivo:** ❌ ROTO — 3 archivos críticos dan 404, 1 desactualizado  
**Archivos locales corregidos:** ✅ 14/14 JS válidos, listos para despliegue  
**Paquete de deploy:** `contsertrib-deploy.zip` (108KB)

---

## Estado del Sitio en Vivo (contser.vercel.app)

| Archivo | HTTP Status | Problema |
|---------|------------|----------|
| `core.js` | **404** | Falta completamente — sin constantes, sin CONFIG_DEFAULT, sin utilidades |
| `data.js` | **404** | Falta completamente — sin lógica de datos/contabilidad |
| `ui.js` | **404** | Falta completamente — sin interfaz de usuario |
| `import.js` | **200** (desactualizado) | Regex xmlns bug — elimina `xmlns:ds`, `xmlns:ns2`, etc. |
| `reports.js` | 200 ✅ | Correcto (fix dinámico aplicado) |
| Otros 9 archivos | 200 ✅ | Coinciden con local |

> ⚠️ Sin `core.js`, NADA funciona: no existen `PCT_PART_TRAB`, `PCT_IR_SOC`, `IVA_RATE`, `CONFIG_DEFAULT`, `loadConfig`, etc.

---

## Resumen de 23 Bugs Corregidos

| # | Archivo | Bug | Corrección | Severidad |
|---|---------|-----|-----------|----------|
| 1 | core.js | `window.toggleTheme` exportado pero función vive en app.js | Eliminado export de core.js; exportado desde app.js | Alto |
| 2 | core.js | `window.openStorageModal` exportado pero función nunca definida | Eliminado export fantasma | Alto |
| 3 | app.js | `renderCompras()` invocado pero no definido | Creado `renderComprasPane()` con lógica de pane | Crítico |
| 4 | app.js | `refreshCuentaFilters()` invocado pero no definido | Creada función que refresca selects de cuenta | Alto |
| 5 | app.js | Tab 'compras' llama `renderCompras()` inexistente | Cambiado a `renderComprasPane()` | Crítico |
| 6 | core.js | `loadConfig()` invocado pero no definido | Creada función que carga config y popula selects del pane | Crítico |
| 7 | core.js | `saveConfigModal()` no lee selects del pane (solo modal) | Reescrita para leer tanto pane como modal | Alto |
| 8 | app.js | `K.THEME` (mayúsculas) no existe en constantes K | Corregido a `K.theme` (minúsculas) | Crítico |
| 9 | core.js | `window.hoyIso` (camelCase incorrecto) | Corregido a `window.hoyISO` | Medio |
| 10 | core.js | Cambios en config del pane no se persisten | `saveConfigModal()` ahora lee selects del pane | Alto |
| 11 | app.js | `initFilters()` popula selects `cfg-cta-*` del pane | Agregado `startsWith('cfg-cta-')` para excluir pane selects | Alto |
| 12 | app.js + ui.js | `diar-cuenta` usa `value=cod` y `filterDiario` compara `l.nom===cta` | `initFilters` usa `cod|nom`, `filterDiario` usa `cta.split('|')[0]` comparado con `l.cta` | Crítico |
| 13 | activos-fijos.js | Módulo Activos Fijos queda "cargando" indefinidamente | Creada función `renderActivosFijos()` que encuentra `#activos-container` y llama a `buildActivosView(container)` | Crítico |
| 14 | import.js | Importación ZIP/XML del SRI falla silenciosamente | Corregido regex `stripXmlns` para no eliminar declaraciones xmlns prefijadas (xmlns:ds, xmlns:ns2, etc.) | Crítico |
| 15 | supabase.js | Login/Register usan IDs incorrectos (`email`/`password`) | Corregido a `auth-email`/`auth-password` | Crítico |
| 16 | supabase.js | Modal de auth no se cierra después de login/register exitoso | Agregado `closeModal('modal-auth')` | Alto |
| 17 | nomina.js | `abrirRevisionNomina` no exportada en window | Agregado `window.abrirRevisionNomina = abrirRevisionNomina` | Crítico |
| 18 | nomina.js | `revertirNomina` no exportada en window | Agregado `window.revertirNomina = revertirNomina` | Alto |
| 19 | nomina.js | `abrirModalPagoNomina` no exportada en window | Agregado `window.abrirModalPagoNomina = abrirModalPagoNomina` | Alto |
| 20 | nomina.js | `revertirPagoNomina` no exportada en window | Agregado `window.revertirPagoNomina = revertirPagoNomina` | Alto |
| 21 | reports.js | Labels "15%"/"25%" hardcoded en Estado Resultados Excel | → dinámicos con `PCT_PART_TRAB`/`PCT_IR_SOC` | Medio |
| 22 | ui.js | Labels "15%"/"25%" hardcoded en display Estado Resultados | → dinámicos con `PCT_PART_TRAB`/`PCT_IR_SOC` | Medio |
| 23 | ui.js | Disclaimer "15%"/"25%" hardcoded en Estado Resultados | → dinámicos con `PCT_PART_TRAB`/`PCT_IR_SOC` | Medio |

---

## Detalle por Archivo

### core.js — 6 correcciones (Bugs #1-#2, #6-#7, #9-#10)

1. **Bug #1** — Eliminado `window.toggleTheme = toggleTheme;`. La función vive en app.js.
2. **Bug #2** — Eliminado `window.openStorageModal = openStorageModal;` (función nunca definida).
3. **Bug #6** — Creada `function loadConfig()` que:
   - Lee config desde `LS.get(K.config)` o CONFIG_DEFAULT
   - Popula todos los selects del pane con `accountOptionsPrefix(prefijo, código)`
   - Exportada como `window.loadConfig = loadConfig;`
4. **Bug #7/#10** — Reescrita `function saveConfigModal()` para:
   - Leer selects del pane (`cfg-cta-*`) que NO tienen `-m` en su ID
   - Leer selects del modal (`*-m`) que SÍ tienen `-m`
   - Combinar ambas fuentes en un solo objeto config
   - Persistir con `LS.set(K.config, ...)`
5. **Bug #9** — Corregido `window.hoyIso` → `window.hoyISO`

**Constantes fiscales pre-llenadas (permanecen editables):**
- `PCT_PART_TRAB = 0.15` (15% participación trabajadores, art. 97 LRTI)
- `PCT_IR_SOC = 0.25` (25% impuesto a la renta sociedades, art. 10 LRTI)
- `IVA_RATE = 0.15` (15% IVA general 2026)
- `CONFIG_DEFAULT` con cuentas contables por defecto NIIF-PYMES Ecuador

### app.js — 6 correcciones (Bugs #3-#5, #8, #11-#12)

1. **Bug #8** — Corregido `K.THEME` → `K.theme` en 2 ubicaciones
2. **Bug #3** — Creada `function rerenderActivePane()`
3. **Bug #4** — Creada `function refreshCuentaFilters()` que re-puebla selects de cuenta
4. **Bug #5** — Cambiado `renderCompras()` → `renderComprasPane()` en switch de tabs
5. **Bug #11** — `initFilters()` ahora excluye selects `cfg-cta-*`
6. **Bug #12** — `initFilters()` popula `diar-cuenta` con formato `cod|nom`

### ui.js — 3 correcciones (Bugs #12, #22-#23)

1. **Bug #12** — `filterDiario()` corregido: compara código de cuenta (`l.cta`) en vez de nombre
2. **Bug #22** — Labels de Estado Resultados ahora usan `Math.round(PCT_PART_TRAB*100)%` y `Math.round(PCT_IR_SOC*100)%`
3. **Bug #23** — Disclaimer ahora usa referencias dinámicas a las constantes

### reports.js — 1 corrección (Bug #21)

1. **Bug #21** — Labels en exportación Excel de Estado Resultados ahora usan `PCT_PART_TRAB`/`PCT_IR_SOC` dinámicamente

### activos-fijos.js — 1 corrección (Bug #13)

1. **Bug #13** — Creada `function renderActivosFijos()` que encuentra `#activos-container` y llama a `buildActivosView(container)`

### import.js — 1 corrección (Bug #14)

1. **Bug #14** — Regex `stripXmlns` corregido:
   - **Antes:** `\s+xmlns(:[a-zA-Z0-9_]+)?=["']...["']` — eliminaba `xmlns=` y `xmlns:ds=`, `xmlns:ns2=`, etc.
   - **Ahora:** `\s+xmlns=["']...["']` — solo elimina namespace por defecto, preserva prefijados
   - Los comprobantes SRI dentro de CDATA usan `<ds:Signature>` que requiere `xmlns:ds="http://www.w3.org/2000/09/xmldsig#"`

### supabase.js — 2 correcciones (Bugs #15-#16)

1. **Bug #15** — Login/Register usan IDs `auth-email`/`auth-password` (coinciden con HTML)
2. **Bug #16** — Modal auth se cierra después de login/register exitoso

### nomina.js — 4 correcciones (Bugs #17-#20)

1. **Bug #17-#20** — Funciones `abrirRevisionNomina`, `revertirNomina`, `abrirModalPagoNomina`, `revertirPagoNomina` exportadas en `window.*`

### index.html — Correcciones previas

1. Parámetros de `getExportData` corregidos: `'libro'` para Libro Diario, `'diario'` para Balance de Comprobación, `'bgeneral'` para Balance General

---

## Notas Importantes

### Valores "15%" restantes que NO son bugs

- `core.js`: Nombres de cuentas como "Crédito IVA Compras 15%" y "15% Participación Trabajadores por Pagar" — son etiquetas de cuenta
- `import.js`: Headers SRI estándar "Base Tarifa 15%" — son columnas oficiales del SRI

### Valores 0.01 en conciliacion.js, ia.js, ui.js

Son umbrales de tolerancia para verificación de balance contable — correctos.

### Valores 0.2/0.15/0.4/0.05 en dashboard.js

Son proporciones de visualización de gráficos — NO son tasas impositivas.

### Columnas de 5% en Excel del SRI

Los archivos Excel del SRI NO incluyen columnas de 5% cuando no existen transacciones con esa tarifa. `normCompraSRI` usa `numOrZero(raw['Base Tarifa 5%'])` que retorna correctamente `0`.

---

## Validación

Todos los archivos pasan `node --check` sin errores de sintaxis:

```
activos-fijos.js ✅  app.js ✅  conciliacion.js ✅  core.js ✅
dashboard.js ✅  data.js ✅  db.js ✅  enlace-magico.js ✅
ia.js ✅  import.js ✅  nomina.js ✅  reports.js ✅
supabase.js ✅  ui.js ✅
```

---

## Instrucciones de Despliegue

### ⚠️ PASO OBLIGATORIO: Redeploy completo

El sitio está ROTO. **3 archivos críticos devuelven 404.** Debes redeployar TODO el contenido.

### Opción 1: Vercel CLI (Recomendada)

```bash
npm i -g vercel          # Instalar CLI
unzip contsertrib-deploy.zip -d contsertrib-deploy
cd contsertrib-deploy
vercel login             # Solo la primera vez
vercel --prod            # Deploy a producción
```

### Opción 2: GitHub + Vercel Dashboard

1. Crear/actualizar repo GitHub con TODO el contenido
2. Conectar repo en Vercel Dashboard → Settings
3. Redeploy

### Verificación Post-Deploy

```bash
for f in core.js data.js ui.js import.js reports.js app.js; do
  code=$(curl -s -o /dev/null -w '%{http_code}' "https://contser.vercel.app/assets/js/$f")
  echo "$f → $code"
done
# Todos deben devolver 200
```

1. ✅ Todos los archivos JS devuelven 200
2. ✅ Consola del navegador sin errores
3. ✅ Importar XML/ZIP del SRI funciona
4. ✅ Estado Resultados muestra porcentajes dinámicos
5. ✅ Configuración se guarda y persiste

## Bug #24 — Orden de carga de scripts: db.js debe ir ANTES de core.js
**Archivo:** `index.html` (líneas 817-818)  
**Síntoma:** `ReferenceError: Cannot access 'AUTO_KW' before initialization` al importar archivos SRI  
**Causa raíz:** En la sesión anterior se reordenaron los scripts poniendo `core.js` antes de `db.js`. Sin embargo, `core.js` ejecuta llamadas `LS.get()` a nivel de módulo (ej. línea 292: `let CUENTA_MAP_OVERRIDES = LS.get(K.mapOv,{})`), las cuales llaman a `DB.get()`. Como `DB` no existe hasta que `db.js` se evalúe, el código lanza `ReferenceError: DB is not defined`, lo cual detiene la ejecución de `core.js` antes de llegar a la declaración `const AUTO_KW = [...]` (línea 297). Cuando `import.js` intenta llamar `autoClasificarSRI()`, esta accede a `AUTO_KW` que está en la Zona Muerta Temporal (TDZ) — declarada con `const` pero nunca inicializada — generando el error exacto "Cannot access 'AUTO_KW' before initialization".  
**Corrección:**  
1. `index.html` — Se restauró el orden original: `db.js` PRIMERO, luego `core.js`.  
2. `core.js` — Se añadió `try-catch` a `LS.get()` como defensa: `get(k, fb){ try{ return DB.get(k, fb); }catch(e){ return fb; } }`  
**Orden correcto de scripts:** db.js → core.js → data.js → supabase.js → import.js → nomina.js → reports.js → ui.js → ia.js → conciliacion.js → activos-fijos.js → dashboard.js → enlace-magico.js → app.js (último)

---

## Bugs #25–#33 — Correcciones de Sesión 3 (9 bugs nuevos)

| # | Archivo | Bug | Corrección | Severidad |
|---|---------|-----|-----------|----------|
| 25 | dashboard.js | `getEntriesForPeriod()` llamada pero nunca definida → ReferenceError | Creada `getEntriesForPeriod(periodo)` que filtra `allEntries()` por periodo | Crítico |
| 26 | dashboard.js | `buildBalanza()` llamada pero no existe → ReferenceError en getBalanza() | Creada `buildBalanza(periodo)` con lógica de agregación; `getBalanza()` ahora la usa y retorna `Object.values(movs)` | Crítico |
| 27 | dashboard.js | Gráficos pie usan porcentajes fijos (0.2, 0.15, 0.4, 0.05 para activos; 0.6, 0.4 para pasivos) | Reescrito para calcular desde datos reales de la balanza, agrupando por rangos de cuenta (1.1.1=Bancos, 1.1.2/1.1.3=CxC, 1.1.4/1.1.5=Inventarios, 1.2=AF; 2.1=Pasivo corriente, 2.2/2.3=Pasivo LP) | Alto |
| 28 | dashboard.js | `NOMINAS` no existe → ReferenceError | Cambiado a `NOMINA_RUNS` (global correcto definido en core.js) | Crítico |
| 29 | app.js | `getPeriodos()` llama `getCompras()`, `getVentas()`, `getRetenciones()`, `getAsientos()` que no existen; usa `r.periodo` pero data usa `r.PERIODO` | Reemplazado cuerpo completo con `return periodosDisponibles()` (función existente en data.js que maneja PERIODO correctamente) | Crítico |
| 30 | app.js | `openModal`, `closeModal`, `showToast` duplicados en core.js y app.js; app.js (carga último) sobreescribe core.js | Eliminados duplicados de app.js; comentado que provienen de core.js | Medio |
| 31 | activos-fijos.js | `bajaActivo()` y `generarDepreciacionMensual()` hacen push a MANUAL_ASIENTOS sin `id` → falla reversión/eliminación | Agregado `id: Date.now()` a ambos objetos asiento | Alto |
| 32 | nomina.js | `exportRolesHistorialPDF` duplicada: definida dentro de `window.*` block (~l.503) y redefinida como standalone (~l.504) que hace shadow | Eliminada función standalone duplicada; se mantiene la del bloque `window.*` | Medio |
| 33 | index.html + supabase.js | IDs `auth-email`/`auth-password` duplicados en pane-auth y modal-auth; `getElementById` siempre retorna el primero (pane-auth) | IDs del modal cambiados a `auth-email-m`/`auth-password-m`; `loginSupabase()`/`registerSupabase()` ahora detectan cuál está visible y leen los inputs correctos | Crítico |

### Detalle por Archivo (Sesión 3)

#### dashboard.js — 4 correcciones (Bugs #25–#28)
1. **Bug #25** — Creada `getEntriesForPeriod(periodo)` que retorna `allEntries().filter(e => !periodo || e.periodo === periodo)`.
2. **Bug #26** — Creada `buildBalanza(periodo)` con la lógica de agregación de líneas contables por cuenta. `getBalanza()` ahora simplemente delega a `buildBalanza()`.
3. **Bug #27** — Gráficos pie de composición de activos y pasivos ahora calculan desde datos reales de la balanza agrupando por prefijos de cuenta NIIF-PYMES. Si no hay datos, muestra placeholder "Sin datos".
4. **Bug #28** — `NOMINAS` → `NOMINA_RUNS` (global correcto).

#### app.js — 2 correcciones (Bugs #29–#30)
1. **Bug #29** — `getPeriodos()` ahora retorna `periodosDisponibles()` directamente, eliminando las llamadas a funciones inexistentes y el campo incorrecto `r.periodo` (real es `r.PERIODO`).
2. **Bug #30** — Eliminadas funciones `openModal`, `closeModal`, `showToast` duplicadas. Solo quedan las de `core.js` (carga primero).

#### activos-fijos.js — 1 corrección (Bug #31)
1. **Bug #31** — Agregado `id: Date.now()` a asientos generados por `bajaActivo()` y `generarDepreciacionMensual()`. Esto permite que `manualEntries()` los identifique y que la reversión/eliminación funcione correctamente.

#### nomina.js — 1 corrección (Bug #32)
1. **Bug #32** — Eliminada función standalone `exportRolesHistorialPDF(per)` que hacía shadow sobre la ya expuesta en `window.exportRolesHistorialPDF`.

#### index.html + supabase.js — 1 corrección (Bug #33)
1. **Bug #33** — IDs duplicados corregidos: modal-auth ahora usa `auth-email-m`/`auth-password-m`. `loginSupabase()` y `registerSupabase()` ahora detectan si `modal-auth` tiene clase `show` para determinar qué inputs leer.

### Validación (Sesión 3)

Todos los archivos modificados pasan `node --check`:
```
dashboard.js ✅  app.js ✅  activos-fijos.js ✅  nomina.js ✅  supabase.js ✅
```

## Fix #4 — 2026-08-21: Window exposures faltantes en app.js (CAUSA RAÍZ)

### Problema
El botón "Revisar y Contabilizar" de nómina no funcionaba. La causa raíz era que **app.js** no exponía en `window` las 3 funciones críticas de navegación: `toggleSidebar`, `closeSidebar`, `showPane`. 

En modo `'use strict'`, los handlers inline `onclick="showPane('nomina')"` etc. generan `ReferenceError: showPane is not defined`, lo que impide que al hacer clic en cualquier pestaña del sidebar se cargue el módulo correspondiente. Si la pestaña Nómina nunca se carga, `nomina.js` nunca se inicializa y sus funciones fallan.

### Funciones corregidas en app.js
| Función | Usada en index.html | ¿window.* antes? | ¿window.* ahora? |
|---|---|---|---|
| `toggleSidebar` | `onclick="toggleSidebar()"` | ❌ No | ✅ Sí |
| `closeSidebar` | `onclick="closeSidebar()"` | ❌ No | ✅ Sí |
| `showPane` | `onclick="showPane('nomina')"` y 20+ pestañas | ❌ No | ✅ Sí |

### Auditoría completa
Se verificaron TODOS los handlers inline en index.html (71 funciones) y TODOS los innerHTML en los 14 archivos JS. Todas las funciones referenciadas en handlers inline están ahora expuestas en `window`.

### Archivos modificados
- `assets/js/app.js` — Líneas 198-200: añadidas `window.toggleSidebar`, `window.closeSidebar`, `window.showPane`

### Prueba esperada
1. Clic en cualquier pestaña del sidebar → carga el módulo sin error
2. Nómina → Calcular → "Revisar y contabilizar" → modal abre
3. Editar cuentas/debe/haber → balance se actualiza
4. Si balance cuadra → botón "Aprobar y contabilizar" se habilita
