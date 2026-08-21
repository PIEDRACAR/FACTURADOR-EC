# 🚀 CONTSERTRIB — Instrucciones de Redeploy en Vercel

## Problema Actual

El sitio **https://contser.vercel.app/** está ROTO:

| Archivo | Estado en Vercel | Problema |
|---------|-----------------|----------|
| `core.js` | ❌ 404 No encontrado | Falta completamente — sin constantes, sin CONFIG, sin utilidades |
| `data.js` | ❌ 404 No encontrado | Falta completamente — sin lógica de datos |
| `ui.js` | ❌ 404 No encontrado | Falta completamente — sin interfaz |
| `import.js` | ⚠️ 200 pero DESACTUALIZADO | Tiene bug regex xmlns que elimina namespaces con prefijo |

Sin `core.js`, el sistema NO funciona: no existen `PCT_PART_TRAB`, `PCT_IR_SOC`, `IVA_RATE`, `CONFIG_DEFAULT`, `loadConfig`, etc.

## Solución: Redeploy Completo

### Opción 1: Vercel CLI (Recomendada)

```bash
# 1. Instalar Vercel CLI si no lo tienes
npm i -g vercel

# 2. Descomprimir el ZIP
cd ~/Desktop   # o donde guardes el zip
unzip contsertrib-deploy.zip -d contsertrib-deploy

# 3. Navegar al directorio
cd contsertrib-deploy

# 4. Login (solo la primera vez)
vercel login

# 5. Deploy a producción
vercel --prod
```

### Opción 2: GitHub + Vercel Dashboard

1. Crear/actualizar un repositorio GitHub con TODO el contenido de la carpeta
2. En Vercel Dashboard → Settings → conectar el repo
3. Asegurar que el root directory sea `.` (la carpeta misma)
4. Redeploy

### Opción 3: Subir manualmente desde Vercel Dashboard

1. Ir a https://vercel.com/dashboard
2. Seleccionar el proyecto `contser`
3. Ir a **Deployments** → seleccionar el último deploy
4. Click en **...** → **Redeploy**
5. Si el proyecto está conectado a GitHub, subir los archivos al repo

## Verificación Post-Deploy

Después de redeploy, verifica:

```bash
# Verificar que TODOS los archivos devuelvan 200
for f in core.js data.js ui.js import.js reports.js app.js db.js supabase.js nomina.js ia.js conciliacion.js activos-fijos.js dashboard.js enlace-magico.js; do
  code=$(curl -s -o /dev/null -w '%{http_code}' "https://contser.vercel.app/assets/js/$f")
  echo "$f → $code"
done
```

Todos deben devolver **200**.

## Verificar Bug Fixes Específicos

1. **Importar XML del SRI** — subir un comprobante electrónico .xml y verificar que no falle el parseo
2. **Estado de Resultados** — verificar que muestre "15% Participación Trabajadores" y "25% Impuesto a la Renta" (no hardcoded)
3. **Configuración** — cambiar valores en ⚙️ y verificar que se guarden
4. **Consola del navegador** — NO debe mostrar errores ReferenceError o 404

## Archivos Corregidos en Este Paquete

| Archivo | Fixes Aplicados |
|---------|----------------|
| `core.js` | Constantes PCT_PART_TRAB/PCT_IR_SOC/IVA_RATE, CONFIG_DEFAULT, loadConfig/saveConfigModal, hoyISO |
| `data.js` | Magic numbers → PCT_PART_TRAB/PCT_IR_SOC |
| `ui.js` | Estado Resultados dinámico (no hardcoded 15%/25%), disclaimer dinámico |
| `import.js` | Regex xmlns corregido: solo elimina `xmlns=`, NO `xmlns:prefix=` |
| `reports.js` | Labels Estado Resultados dinámicos con PCT_PART_TRAB/PCT_IR_SOC |
| `activos-fijos.js` | SRI_ACTIVOS_GRUPOS + ACTIVO_CUENTA_MAP corregidos |
| `app.js` | renderComprasPane, refreshCuentaFilters, K.theme, filterDiario |
| `supabase.js` | IDs auth-email/auth-password, cierre modal-auth |
| `nomina.js` | Funciones expuestas en window.*, parámetros nómina verificados |

## Estructura del Paquete

```
contsertrib/
├── index.html
├── vercel.json
├── assets/
│   ├── css/app.css
│   └── js/
│       ├── core.js          ← CRÍTICO (404 en Vercel)
│       ├── db.js
│       ├── data.js          ← CRÍTICO (404 en Vercel)
│       ├── supabase.js
│       ├── import.js         ← DESACTUALIZADO en Vercel
│       ├── nomina.js
│       ├── reports.js
│       ├── ui.js            ← CRÍTICO (404 en Vercel)
│       ├── ia.js
│       ├── conciliacion.js
│       ├── activos-fijos.js
│       ├── dashboard.js
│       ├── enlace-magico.js
│       └── app.js
```
