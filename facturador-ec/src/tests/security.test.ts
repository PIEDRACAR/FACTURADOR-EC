import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

process.env.SUPABASE_URL ||= 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role';
process.env.SECRETS_ENCRYPTION_KEY ||= '00'.repeat(32);
process.env.PAYPHONE_TOKEN ||= 'test-token';
process.env.PAYPHONE_STORE_ID ||= 'test-store';

test('A: asociar una identidad existente nunca actualiza su contraseña', async () => {
  const llamadas:Array<{url:string;method:string}> = [];
  const anterior=globalThis.fetch;
  globalThis.fetch=(async(input:RequestInfo|URL,init?:RequestInit)=>{
    const url=String(input); const method=String(init?.method??'GET'); llamadas.push({url,method});
    if(method==='POST') return new Response(JSON.stringify({message:'already exists'}),{status:422});
    return new Response(JSON.stringify({users:[{id:'usuario-existente',email:'existente@example.com'}]}),{status:200,headers:{'content-type':'application/json'}});
  }) as typeof fetch;
  try {
    const {crearOEncontrarUsuario}=await import('../auth/sesiones.js');
    const id=await crearOEncontrarUsuario('existente@example.com','no-debe-usarse');
    assert.equal(id,'usuario-existente');
    assert.equal(llamadas.some(x=>x.method==='PUT'||x.method==='PATCH'),false);
  } finally { globalThis.fetch=anterior; }
});

test('C: una respuesta PayPhone no aprobada o alterada es rechazada', async()=>{
  const {validarConfirmacionPayphone}=await import('../services/pagosSaas.js');
  assert.throws(()=>validarConfirmacionPayphone({clientTransactionId:'TX1',transactionId:7,statusCode:2,transactionStatus:'Canceled',amount:1000,currency:'USD'},{clientTransactionId:'TX1',monto:10}),/no confirm/i);
  assert.throws(()=>validarConfirmacionPayphone({clientTransactionId:'TX-OTRA',transactionId:7,statusCode:3,transactionStatus:'Approved',amount:1000,currency:'USD'},{clientTransactionId:'TX1',monto:10}),/referencia diferente/i);
  assert.throws(()=>validarConfirmacionPayphone({clientTransactionId:'TX1',transactionId:7,statusCode:3,transactionStatus:'Approved',amount:900,currency:'USD'},{clientTransactionId:'TX1',monto:10}),/monto/i);
});

test('E: el helper compartido neutraliza etiquetas script',()=>{
  const codigo=readFileSync(new URL('../../public/security.js',import.meta.url),'utf8');
  const contexto:{window:Record<string,any>,location:any,Headers:typeof Headers}={window:{fetch:async()=>new Response()},location:{href:'https://app.test/',origin:'https://app.test'},Headers};
  vm.runInNewContext(codigo,contexto);
  const salida=contexto.window.CONTSERTRIB_SECURITY.escapeHtml('<script>alert(1)</script>');
  assert.equal(salida,'&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.equal(salida.includes('<script>'),false);
});

test('C1: timeout PayPhone falla cerrado',async()=>{
  const {consultarTransaccionPayphone}=await import('../services/pagosSaas.js');
  const colgado=((_input:RequestInfo|URL,init?:RequestInit)=>new Promise<Response>((_resolve,reject)=>init?.signal?.addEventListener('abort',()=>reject(Object.assign(new Error('aborted'),{name:'AbortError'}))))) as typeof fetch;
  await assert.rejects(()=>consultarTransaccionPayphone('TX1','7',colgado,5),/tiempo permitido/i);
});

test('C2: respuesta PayPhone incompleta falla cerrado',async()=>{
  const {validarConfirmacionPayphone}=await import('../services/pagosSaas.js');
  assert.throws(()=>validarConfirmacionPayphone({clientTransactionId:'TX1',statusCode:3,transactionStatus:'Approved'},{clientTransactionId:'TX1',monto:10}),/TransactionId|Moneda|monto/i);
});

test('ROOT: reenvío de acceso usa recuperación y no cambia ni expone contraseña',()=>{
  const codigo=readFileSync(new URL('../../src/routes/proveedor.ts',import.meta.url),'utf8');
  const inicio=codigo.indexOf("'/proveedor/clientes/:emisorId/reenvio-acceso'");
  const bloque=codigo.slice(inicio,inicio+1800);
  assert.match(bloque,/resetPasswordForEmail/);
  assert.doesNotMatch(bloque,/admin\/users|passwordTemporal|JSON\.stringify\(\{\s*password/);
});

test('Sesión: logout elimina sesión y negocio activo',()=>{
  const codigo=readFileSync(new URL('../../src/routes/auth.ts',import.meta.url),'utf8');
  const inicio=codigo.indexOf("app.post('/auth/logout'");const bloque=codigo.slice(inicio,inicio+500);
  assert.match(bloque,/clearCookie\(NOMBRE_COOKIE/);assert.match(bloque,/clearCookie\('negocio_activo'/);
});

test('CSRF: mutaciones cross-site y sin prueba de origen se rechazan',async()=>{
  const {solicitudMutableConfiable}=await import('../auth/seguridadWeb.js');
  assert.equal(solicitudMutableConfiable({'sec-fetch-site':'cross-site',origin:'https://evil.test'},'/api','app.test'),false);
  assert.equal(solicitudMutableConfiable({},'/api','app.test'),false);
  assert.equal(solicitudMutableConfiable({'x-requested-with':'XMLHttpRequest','sec-fetch-site':'same-origin'},'/api','app.test'),true);
});

test('XSS: páginas corregidas no conservan interpolaciones peligrosas conocidas',()=>{
  const archivos=['caja.html','cuentas-por-cobrar.html','cuentas-por-pagar.html','login.html','planes.html','registro.html','usuarios-admin.html','inventario.html','inicio.html'];
  for(const archivo of archivos){const html=readFileSync(new URL('../../public/'+archivo,import.meta.url),'utf8');assert.equal(html.includes('${u.email}</div>'),false,archivo);assert.equal(html.includes('${m.concepto}'),false,archivo);assert.equal(html.includes('${p.nombre} —'),false,archivo);}
});

test('F: ROOT usa un espacio de limitación separado',async()=>{
  const {claveLimiteLogin}=await import('../routes/auth.js');
  assert.notEqual(claveLimiteLogin('127.0.0.1','root@example.com'),claveLimiteLogin('127.0.0.1','root@example.com',true));
});

test('G: login se bloquea después de intentos repetidos',async()=>{
  const {claveLimiteLogin,registrarFalloLogin,comprobarLimiteLogin,limpiarFallosLogin}=await import('../routes/auth.js');
  const clave=claveLimiteLogin('192.0.2.20','prueba@example.com');
  limpiarFallosLogin(clave);
  for(let i=0;i<8;i++) registrarFalloLogin(clave,1_000);
  assert.ok(comprobarLimiteLogin(clave,1_001)>0);
  limpiarFallosLogin(clave);
});

test.skip('B: aislamiento multiempresa contra una base Supabase de pruebas',()=>{
  // Requiere TEST_SUPABASE_URL, TEST_SUPABASE_SERVICE_ROLE_KEY y dos emisores fixture.
});

test.skip('D: entrega duplicada PayPhone activa una sola vez en base de pruebas',()=>{
  // Requiere una transacción PayPhone sandbox aprobada y Supabase de integración.
  // La defensa productiva combina índice único transaction_id, actualización
  // condicional estado=link_generado y activacion_at idempotente.
});

test.skip('D1: dos procesos concurrentes solo obtienen un claim de activación',()=>{
  // Requiere Supabase sandbox: dos procesos deben competir usando el mismo updated_at.
  // Solo el UPDATE optimista que cambia updated_at puede devolver la fila reclamada.
});
