import { supabase } from '../db/supabase.js';
import { reversarAsientoContable } from './motorContable.js';
import { resolverCuentas } from './configuracionContable.js';
import { contabilizarEvento } from './eventosContables.js';
import { calcularRolEmpleado, construirAsientoNomina, construirAsientoPagoNomina, estadoSiguientePermitido, parametrosVigentes, resumirPagos, type ParametroNomina, type NovedadCalculo } from './nominaCalculos.js';

const money=(n:any)=>Math.round((Number(n)||0)*100)/100;
const fechaFin=(periodo:string)=>{const [y,m]=periodo.split('-').map(Number);return new Date(Date.UTC(y,m,0)).toISOString().slice(0,10);};
const validarPeriodo=(p:string)=>{if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(p))throw new Error('Periodo YYYY-MM invalido.');return p;};

export async function cargarParametrosNomina(emisorId:string,periodo:string){
  validarPeriodo(periodo);const fecha=fechaFin(periodo);
  const {data,error}=await supabase.from('nomina_parametros').select('*').eq('activo',true).lte('vigencia_desde',fecha).or(`vigencia_hasta.is.null,vigencia_hasta.gte.${fecha}`).or(`emisor_id.is.null,emisor_id.eq.${emisorId}`);
  if(error)throw new Error(error.message);
  const globales=(data||[]).filter((x:any)=>!x.emisor_id),empresa=(data||[]).filter((x:any)=>x.emisor_id===emisorId),porCodigo=new Map<string,any>();
  for(const x of globales)porCodigo.set(x.codigo,x);for(const x of empresa)porCodigo.set(x.codigo,x);
  const lista=[...porCodigo.values()].map((x:any)=>({codigo:x.codigo,nombre:x.nombre,valor:Number(x.valor),tipo:x.tipo,vigenciaDesde:x.vigencia_desde,vigenciaHasta:x.vigencia_hasta,fuente:x.fuente,observacion:x.observacion,emisorId:x.emisor_id}));
  parametrosVigentes(lista as ParametroNomina[],periodo);return lista as ParametroNomina[];
}

async function datosCalculo(emisorId:string,periodo:string){
  const [parametros,er,nr,sr]=await Promise.all([
    cargarParametrosNomina(emisorId,periodo),
    supabase.from('nomina_empleados').select('*').eq('emisor_id',emisorId).lte('fecha_ingreso',fechaFin(periodo)).or(`fecha_salida.is.null,fecha_salida.gte.${periodo}-01`).order('nombres'),
    supabase.from('nomina_novedades').select('*,nomina_rubros(codigo,nombre,tipo,afecta_iess,afecta_beneficios,cuenta_debito_clave,cuenta_credito_clave)').eq('emisor_id',emisorId).eq('periodo',periodo).eq('estado','REGISTRADA'),
    supabase.from('nomina_historial_salarial').select('*').eq('emisor_id',emisorId).lte('vigencia_desde',fechaFin(periodo)).or(`vigencia_hasta.is.null,vigencia_hasta.gte.${fechaFin(periodo)}`),
  ]);if(er.error)throw new Error(er.error.message);if(nr.error)throw new Error(nr.error.message);if(sr.error)throw new Error(sr.error.message);
  const salarios=new Map((sr.data||[]).map((x:any)=>[x.empleado_id,Number(x.valor)]));
  const rows=(er.data||[]).map((e:any)=>{const novedades=(nr.data||[]).filter((n:any)=>n.empleado_id===e.id).map((n:any)=>({idempotenciaClave:n.idempotencia_clave,tipo:n.nomina_rubros?.tipo||n.tipo,valor:Number(n.valor),cantidad:Number(n.cantidad||0),afectaIess:Boolean(n.nomina_rubros?.afecta_iess),codigo:n.nomina_rubros?.codigo,descripcion:n.descripcion,centroCostoId:n.centro_costo_id} as NovedadCalculo));const calc=calcularRolEmpleado({id:e.id,sueldoBase:salarios.get(e.id)??Number(e.sueldo_base),fechaIngreso:e.fecha_ingreso,fechaSalida:e.fecha_salida,iessBase:e.iess_base,acumulaDecimoTercero:e.acumula_decimo_tercero,acumulaDecimoCuarto:e.acumula_decimo_cuarto,fondoReservaMensual:e.fondo_reserva_mensual},periodo,parametros,novedades);return {...calc,identificacion:e.identificacion,nombres:e.nombres,cargo:e.cargo,empleadoSnapshot:{id:e.id,identificacion:e.identificacion,nombres:e.nombres,cargo:e.cargo,fechaIngreso:e.fecha_ingreso,fechaSalida:e.fecha_salida,sueldoBase:salarios.get(e.id)??Number(e.sueldo_base),acumulaDecimoTercero:Boolean(e.acumula_decimo_tercero),acumulaDecimoCuarto:Boolean(e.acumula_decimo_cuarto),fondoReservaMensual:Boolean(e.fondo_reserva_mensual)}};});
  return {parametros,rows,totales:totalizarRoles(rows)};
}

export function totalizarRoles(rows:any[]){const s=(k:string)=>money(rows.reduce((a,x)=>a+Number(x[k]||0),0));return {sueldo:s('sueldo'),otrosIngresos:s('otrosIngresos'),otrasDeducciones:s('otrasDeducciones'),iessPersonal:s('iessPersonal'),iessPatronal:s('iessPatronal'),decimoTercero:s('decimoTercero'),decimoCuarto:s('decimoCuarto'),vacaciones:s('vacaciones'),fondoReserva:s('fondoReserva'),beneficiosAcumulados:s('beneficiosAcumulados'),netoPagar:s('netoPagar'),costoEmpleador:s('costoEmpleador')};}
export async function previsualizarNomina(emisorId:string,periodo:string){return datosCalculo(emisorId,validarPeriodo(periodo));}

export async function obtenerPeriodoNomina(emisorId:string,periodo:string){
  validarPeriodo(periodo);const pr=await supabase.from('nomina_periodos').select('*').eq('emisor_id',emisorId).eq('periodo',periodo).maybeSingle();if(pr.error)throw new Error(pr.error.message);if(!pr.data)return {periodo:null,empleados:[],totales:{}};
  const dr=await supabase.from('nomina_detalles').select('*').eq('periodo_id',pr.data.id);if(dr.error)throw new Error(dr.error.message);
  return {periodo:pr.data,empleados:(dr.data||[]).map((d:any)=>({...d,...d.empleado_snapshot,empleadoId:d.empleado_id,diasPagados:Number(d.dias_pagados),iessPersonal:Number(d.iess_personal),iessPatronal:Number(d.iess_patronal),decimoTercero:Number(d.decimo_tercero),decimoCuarto:Number(d.decimo_cuarto),fondoReserva:Number(d.fondo_reserva),netoPagar:Number(d.neto_pagar)})),totales:totalizarRoles((dr.data||[]).map((d:any)=>({sueldo:d.sueldo,iessPersonal:d.iess_personal,iessPatronal:d.iess_patronal,decimoTercero:d.decimo_tercero,decimoCuarto:d.decimo_cuarto,vacaciones:d.vacaciones,fondoReserva:d.fondo_reserva,beneficiosAcumulados:d.beneficios_acumulados,netoPagar:d.neto_pagar,costoEmpleador:d.costo_empleador,otrosIngresos:Number(d.total_ingresos||0)-Number(d.sueldo||0),otrasDeducciones:d.total_descuentos})))};
}

export async function calcularNomina(emisorId:string,periodo:string,userId?:string,recalcular=false){
  validarPeriodo(periodo);let pr=await supabase.from('nomina_periodos').select('*').eq('emisor_id',emisorId).eq('periodo',periodo).maybeSingle();if(pr.error)throw new Error(pr.error.message);
  if(pr.data&&!['BORRADOR','ABIERTO','CALCULADO'].includes(String(pr.data.estado)))throw new Error(`La nomina ${pr.data.estado} no puede recalcularse.`);if(pr.data?.estado==='CALCULADO'&&!recalcular)throw new Error('Use RECALCULAR para reemplazar un cálculo existente.');
  if(!pr.data){const ins=await supabase.from('nomina_periodos').insert({emisor_id:emisorId,periodo,estado:'BORRADOR'}).select('*').single();if(ins.error)throw new Error(ins.error.message);pr={...ins} as any;}
  const calculo=await datosCalculo(emisorId,periodo),pid=pr.data.id;
  for(const x of calculo.rows){const row={periodo_id:pid,empleado_id:x.empleadoId,dias_pagados:x.diasPagados,sueldo:x.sueldo,horas_extra:0,comisiones:0,bonificaciones:0,otros_ingresos:x.otrosIngresos,iess_base:x.iessBase,iess_personal:x.iessPersonal,iess_patronal:x.iessPatronal,decimo_tercero:x.decimoTercero,decimo_cuarto:x.decimoCuarto,vacaciones:x.vacaciones,fondo_reserva:x.fondoReserva,otras_deducciones:x.otrasDeducciones,beneficios_acumulados:x.beneficiosAcumulados,neto_pagar:x.netoPagar,costo_empleador:x.costoEmpleador,total_ingresos:money(x.sueldo+x.otrosIngresos),total_descuentos:money(x.iessPersonal+x.otrasDeducciones),saldo_pendiente:x.netoPagar,parametros_snapshot:x.parametrosSnapshot,rubros_snapshot:x.novedadesSnapshot,empleado_snapshot:x.empleadoSnapshot};const u=await supabase.from('nomina_detalles').upsert(row,{onConflict:'periodo_id,empleado_id'});if(u.error)throw new Error(u.error.message);}
  const snapshot=Object.fromEntries(calculo.parametros.map(p=>[p.codigo,p]));const up=await supabase.from('nomina_periodos').update({estado:'CALCULADO',parametros_snapshot:snapshot,total_nomina:calculo.totales.netoPagar,total_pagado:0,saldo_pendiente:calculo.totales.netoPagar,updated_at:new Date().toISOString()}).eq('id',pid).eq('emisor_id',emisorId);if(up.error)throw new Error(up.error.message);
  await auditar(emisorId,'PERIODO_NOMINA',pid,recalcular?'RECALCULAR':'CALCULAR',userId,null,{estado:'CALCULADO',totales:calculo.totales});return {periodo:{...pr.data,estado:'CALCULADO',parametros_snapshot:snapshot,total_nomina:calculo.totales.netoPagar,saldo_pendiente:calculo.totales.netoPagar},empleados:calculo.rows,totales:calculo.totales};
}

export async function cambiarEstadoNomina(emisorId:string,periodoId:string,nuevo:string,userId?:string,observacion?:string){const r=await supabase.from('nomina_periodos').select('*').eq('id',periodoId).eq('emisor_id',emisorId).single();if(r.error||!r.data)throw new Error('Periodo no encontrado para la empresa activa.');const actual=String(r.data.estado)==='ABIERTO'?'BORRADOR':String(r.data.estado);if(!estadoSiguientePermitido(actual,nuevo))throw new Error(`Transicion ${actual} -> ${nuevo} no permitida.`);const extra:any={estado:nuevo,updated_at:new Date().toISOString()};if(nuevo==='REVISADO'){extra.revisado_por=userId;extra.revisado_at=new Date().toISOString();}if(nuevo==='APROBADO'){extra.aprobado_por=userId;extra.aprobado_at=new Date().toISOString();}const u=await supabase.from('nomina_periodos').update(extra).eq('id',periodoId).eq('emisor_id',emisorId);if(u.error)throw new Error(u.error.message);await supabase.from('nomina_aprobaciones').insert({emisor_id:emisorId,periodo_id:periodoId,estado_anterior:actual,estado_nuevo:nuevo,observacion:observacion||null,usuario_id:userId||null});return {...r.data,...extra};}

async function auditar(emisorId:string,tipo:string,id:string,accion:string,userId?:string,antes?:unknown,despues?:unknown){await supabase.from('nomina_auditoria').insert({emisor_id:emisorId,entidad_tipo:tipo,entidad_id:id,accion,antes:antes||null,despues:despues||null,usuario_id:userId||null});}

export async function contabilizarPeriodoNomina(emisorId:string,periodoId:string,userId?:string){
  const p=await supabase.from('nomina_periodos').select('*').eq('id',periodoId).eq('emisor_id',emisorId).single();if(p.error||!p.data)throw new Error('Periodo no encontrado.');if(p.data.asiento_id)return {id:p.data.asiento_id,estado:'YA_CONTABILIZADO'};if(p.data.estado!=='APROBADO')throw new Error('Solo una nomina APROBADA puede contabilizarse.');
  const d=await supabase.from('nomina_detalles').select('*').eq('periodo_id',periodoId);if(d.error||!d.data?.length)throw new Error('Periodo sin roles calculados.');const t=totalizarRoles(d.data.map((x:any)=>({sueldo:x.sueldo,iessPersonal:x.iess_personal,iessPatronal:x.iess_patronal,decimoTercero:x.decimo_tercero,decimoCuarto:x.decimo_cuarto,vacaciones:x.vacaciones,fondoReserva:x.fondo_reserva,beneficiosAcumulados:x.beneficios_acumulados,netoPagar:x.neto_pagar,otrasDeducciones:x.otras_deducciones})) as any);const fecha=fechaFin(p.data.periodo);
  const claves=['NOMINA_GASTO_SUELDOS',...(t.otrosIngresos>0?['NOMINA_GASTO_OTROS_INGRESOS']:[]),'NOMINA_GASTO_APORTE_PATRONAL','NOMINA_GASTO_DECIMO_TERCERO','NOMINA_GASTO_DECIMO_CUARTO','NOMINA_GASTO_VACACIONES','NOMINA_GASTO_FONDO_RESERVA','NOMINA_SUELDOS_POR_PAGAR','NOMINA_IESS_POR_PAGAR','NOMINA_DECIMO_TERCERO_POR_PAGAR','NOMINA_DECIMO_CUARTO_POR_PAGAR','NOMINA_VACACIONES_POR_PAGAR','NOMINA_FONDO_RESERVA_POR_PAGAR',...(t.otrasDeducciones>0?['NOMINA_OTRAS_DEDUCCIONES_POR_PAGAR']:[])];const c=await resolverCuentas(emisorId,claves,fecha);
  const add=(k:string,debe:number,haber:number,descripcion:string)=>({codigo:c[k].codigo,debe,haber,descripcion});
  const d13Ac=money(d.data.reduce((s:number,x:any)=>s+(x.empleado_snapshot?.acumulaDecimoTercero?Number(x.decimo_tercero||0):0),0)),d14Ac=money(d.data.reduce((s:number,x:any)=>s+(x.empleado_snapshot?.acumulaDecimoCuarto?Number(x.decimo_cuarto||0):0),0)),frAc=money(d.data.reduce((s:number,x:any)=>s+(!x.empleado_snapshot?.fondoReservaMensual?Number(x.fondo_reserva||0):0),0));
  const lineas=construirAsientoNomina([add('NOMINA_GASTO_SUELDOS',t.sueldo,0,'Sueldos'),...(t.otrosIngresos>0?[add('NOMINA_GASTO_OTROS_INGRESOS',t.otrosIngresos,0,'Horas, comisiones y otros ingresos')]:[]),add('NOMINA_GASTO_APORTE_PATRONAL',t.iessPatronal,0,'Aporte patronal'),add('NOMINA_GASTO_DECIMO_TERCERO',t.decimoTercero,0,'Provision decimo tercero'),add('NOMINA_GASTO_DECIMO_CUARTO',t.decimoCuarto,0,'Provision decimo cuarto'),add('NOMINA_GASTO_VACACIONES',t.vacaciones,0,'Provision vacaciones'),add('NOMINA_GASTO_FONDO_RESERVA',t.fondoReserva,0,'Fondos de reserva'),add('NOMINA_SUELDOS_POR_PAGAR',0,t.netoPagar,'Sueldos por pagar'),add('NOMINA_IESS_POR_PAGAR',0,money(t.iessPersonal+t.iessPatronal),'IESS por pagar'),add('NOMINA_DECIMO_TERCERO_POR_PAGAR',0,d13Ac,'Decimo tercero por pagar'),add('NOMINA_DECIMO_CUARTO_POR_PAGAR',0,d14Ac,'Decimo cuarto por pagar'),add('NOMINA_VACACIONES_POR_PAGAR',0,t.vacaciones,'Vacaciones por pagar'),add('NOMINA_FONDO_RESERVA_POR_PAGAR',0,frAc,'Fondos de reserva por pagar'),...(t.otrasDeducciones>0?[add('NOMINA_OTRAS_DEDUCCIONES_POR_PAGAR',0,t.otrasDeducciones,'Otras deducciones')]:[])]);
  const z=await contabilizarEvento({emisorId,tipoEvento:'CONTABILIZAR_NOMINA',entidadTipo:'NOMINA_PERIODO',entidadId:periodoId,fechaContable:fecha,tipoAsiento:'NOMINA',concepto:`Nomina ${p.data.periodo}`,referencia:p.data.periodo,lineas,snapshot:{cuentas:Object.fromEntries(Object.entries(c).map(([k,v])=>[k,v.snapshot])),parametros:p.data.parametros_snapshot},createdBy:userId,origenTipo:'NOMINA_PERIODO',origenId:periodoId});
  const u=await supabase.from('nomina_periodos').update({estado:'CONTABILIZADO',asiento_id:z.asientoId,contabilizado_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('id',periodoId).eq('emisor_id',emisorId);if(u.error)throw new Error(u.error.message);await auditar(emisorId,'PERIODO_NOMINA',periodoId,'CONTABILIZAR',userId,null,{asientoId:z.asientoId});return {id:z.asientoId,estado:z.estado};
}

export async function registrarPagoNomina(emisorId:string,periodoId:string,input:{fecha:string;monto:number;formaPago:string;referencia?:string;observacion?:string;idempotenciaClave:string},userId?:string){
  const p=await supabase.from('nomina_periodos').select('*').eq('id',periodoId).eq('emisor_id',emisorId).single();if(p.error||!p.data)throw new Error('Periodo no encontrado.');if(!['CONTABILIZADO','PAGADO'].includes(p.data.estado))throw new Error('La nomina debe estar CONTABILIZADA antes del pago.');const existente=await supabase.from('nomina_pagos').select('*').eq('emisor_id',emisorId).eq('idempotencia_clave',input.idempotenciaClave).maybeSingle();if(existente.data)return {...existente.data,estado:'YA_REGISTRADO'};
  const pagos=await supabase.from('nomina_pagos').select('monto').eq('emisor_id',emisorId).eq('periodo_id',periodoId);if(pagos.error)throw new Error(pagos.error.message);const resumen=resumirPagos(Number(p.data.total_nomina||0),[...(pagos.data||[]).map((x:any)=>Number(x.monto)),Number(input.monto)]);
  const medioClave=input.formaPago==='CAJA'?'CAJA':'BANCOS',c=await resolverCuentas(emisorId,['NOMINA_SUELDOS_POR_PAGAR',medioClave],input.fecha);const ins=await supabase.from('nomina_pagos').insert({emisor_id:emisorId,periodo_id:periodoId,fecha_pago:input.fecha,monto:money(input.monto),forma_pago_codigo:input.formaPago,referencia:input.referencia||null,observacion:input.observacion||null,idempotencia_clave:input.idempotenciaClave,cuenta_contable_id:c[medioClave].id,saldo_anterior:money(Number(p.data.total_nomina||0)-Number(p.data.total_pagado||0)),saldo_posterior:resumen.pendiente,created_by:userId||null}).select('*').single();if(ins.error){if(ins.error.code==='23505'){const ex=await supabase.from('nomina_pagos').select('*').eq('emisor_id',emisorId).eq('idempotencia_clave',input.idempotenciaClave).single();if(ex.data)return {...ex.data,estado:'YA_REGISTRADO'};}throw new Error(ins.error.message);}
  const lineas=construirAsientoPagoNomina(Number(input.monto),c.NOMINA_SUELDOS_POR_PAGAR.codigo,c[medioClave].codigo);const z=await contabilizarEvento({emisorId,tipoEvento:'PAGO_NOMINA',entidadTipo:'NOMINA_PAGO',entidadId:ins.data.id,fechaContable:input.fecha,tipoAsiento:'PAGO_NOMINA',concepto:`Pago nomina ${p.data.periodo}`,referencia:input.referencia||input.idempotenciaClave,lineas,snapshot:{cuentas:[c.NOMINA_SUELDOS_POR_PAGAR.snapshot,c[medioClave].snapshot]},createdBy:userId,origenTipo:'NOMINA_PAGO',origenId:ins.data.id});
  await supabase.from('nomina_pagos').update({asiento_id:z.asientoId,updated_at:new Date().toISOString()}).eq('id',ins.data.id).eq('emisor_id',emisorId);await supabase.from('nomina_periodos').update({estado:resumen.estado,total_pagado:resumen.pagado,saldo_pendiente:resumen.pendiente,updated_at:new Date().toISOString()}).eq('id',periodoId).eq('emisor_id',emisorId);return {...ins.data,asiento_id:z.asientoId,resumen,estado:'REGISTRADO'};
}


export async function listarPagosNomina(emisorId:string,periodoId:string){
  const p=await supabase.from('nomina_periodos').select('id').eq('id',periodoId).eq('emisor_id',emisorId).maybeSingle();
  if(p.error)throw new Error(p.error.message);if(!p.data)throw new Error('Periodo no encontrado.');
  const r=await supabase.from('nomina_pagos').select('*').eq('emisor_id',emisorId).eq('periodo_id',periodoId).order('fecha_pago',{ascending:false});
  if(r.error)throw new Error(r.error.message);return r.data||[];
}

export async function reversarPagoNomina(emisorId:string,pagoId:string,fecha:string,motivo:string,userId?:string){
  const r=await supabase.from('nomina_pagos').select('*').eq('id',pagoId).eq('emisor_id',emisorId).single();
  if(r.error||!r.data)throw new Error('Pago de nomina no encontrado.');
  if(r.data.reverso_asiento_id)return {...r.data,estado:'YA_REVERSADO'};
  if(!r.data.asiento_id)throw new Error('El pago no tiene asiento contable para reversar.');
  const reverso=await reversarAsientoContable(String(r.data.asiento_id),emisorId,fecha,motivo,userId);
  const pagos=await supabase.from('nomina_pagos').select('monto,id').eq('emisor_id',emisorId).eq('periodo_id',r.data.periodo_id).neq('id',pagoId).is('reverso_asiento_id',null);
  if(pagos.error)throw new Error(pagos.error.message);
  const pr=await supabase.from('nomina_periodos').select('total_nomina').eq('id',r.data.periodo_id).eq('emisor_id',emisorId).single();
  if(pr.error||!pr.data)throw new Error('Periodo no encontrado.');
  const resumen=resumirPagos(Number(pr.data.total_nomina||0),(pagos.data||[]).map((x:any)=>Number(x.monto)));
  const u=await supabase.from('nomina_pagos').update({reverso_asiento_id:reverso.id,estado:'REVERSADO',updated_at:new Date().toISOString()}).eq('id',pagoId).eq('emisor_id',emisorId);
  if(u.error)throw new Error(u.error.message);
  await supabase.from('nomina_periodos').update({estado:resumen.estado,total_pagado:resumen.pagado,saldo_pendiente:resumen.pendiente,updated_at:new Date().toISOString()}).eq('id',r.data.periodo_id).eq('emisor_id',emisorId);
  await auditar(emisorId,'NOMINA_PAGO',pagoId,'REVERSAR',userId,r.data,{reversoAsientoId:reverso.id,motivo});
  return {...r.data,reverso_asiento_id:reverso.id,estado:'REVERSADO',resumen};
}
