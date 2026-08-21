/* CONTSERTRIB · Importación SRI (Excel, XML individual y ZIP masivo) */
'use strict';

let PENDING_IMPORT=null, PENDING_STATS=null;

/* --- helpers de fecha/número --- */
function excelSerialToDate(s){ return new Date(Math.floor(s-25569)*86400*1000); }
function parseFecha(v, iso){
  if(v instanceof Date && !isNaN(v)) return iso? v.toISOString().slice(0,10) : `${String(v.getUTCDate()).padStart(2,'0')}/${String(v.getUTCMonth()+1).padStart(2,'0')}/${v.getUTCFullYear()}`;
  if(typeof v==='number' && isFinite(v)) return parseFecha(excelSerialToDate(v), iso);
  const s=String(v||'').trim();
  if(/^\d{4}-\d{2}-\d{2}/.test(s)){ const p=s.slice(0,10).split('-'); return iso? s.slice(0,10) : `${p[2]}/${p[1]}/${p[0]}`; }
  if(/^\d{2}\/\d{2}\/\d{4}/.test(s)){ const p=s.slice(0,10).split('/'); return iso? `${p[2]}-${p[1]}-${p[0]}` : s.slice(0,10); }
  return '';
}
function idTexto(v){ let s=String(v==null?'':v).trim(); if(s.startsWith("'")) s=s.slice(1); return s; }
function esCedula10(v){ const s=String(v||'').trim().replace(/'/g,''); return /^\d{10}$/.test(s); }

/* --- normalizadores Excel SRI --- */
function normCompraSRI(raw, sign, esNota){
  const f=parseFecha(raw['Fecha Emisión'],true);
  const baseExe=numOrZero(raw['Base Exenta de IVA']), baseNo=numOrZero(raw['Base No Objeto de IVA']);
  const b0=numOrZero(raw['Base Tarifa 0']), b5=numOrZero(raw['Base Tarifa 5%']), b15=numOrZero(raw['Base Tarifa 15%']);
  const iva=round2(numOrZero(raw['Monto IVA 5%'])+numOrZero(raw['Monto IVA 15%']));
  const bn=round2(baseExe+baseNo+b0+b5+b15);
  const ice=numOrZero(raw['Monto ICE']), irbpn=numOrZero(raw['Monto IRBPNR']), prop=numOrZero(raw['Propina']);
  const total=numOrZero(raw['Importe Total']);
  const cat=String(raw['Categoría']||'').trim(), tipo=String(raw['Tipo de Comprobante']||'').trim();
  const resumen=[tipo,(cat&&cat!=='Sin categorizar')?cat:''].filter(Boolean).join(' · ');
  const noDoc=String(raw['No. de Documento']||'').trim();
  return {
    "FECHA EMISION":f,"FECHA AUT":parseFecha(raw['Fecha Autorización'],false),
    "RUC EMISOR":idTexto(raw['No. Id. Emisor']),"RAZON SOCIAL EMISOR":String(raw['Razón Social Emisor']||'').trim(),
    "PERIODO":f.slice(0,7),"TIPODOC":esNota?'NC':'FAC',"CUENTA":autoClasificarSRI(cat,resumen),
    "RESUMEN":(esNota?'[NOTA DE CRÉDITO] ':'')+(resumen||'Importado del SRI · pendiente de clasificar'),
    "NO COMPROBANTE":(esNota?'NC-':'')+noDoc,"AUTORIZACION":idTexto(raw['Autorización']),
    "BASE NOOBJ":round2(baseNo*sign),"BASE EXIVA":round2(baseExe*sign),"BASECERO":round2(b0*sign),
    "BASE5":round2(b5*sign),"BASE15":round2(b15*sign),"IVA":round2(iva*sign),"BASENETA":round2(bn*sign),
    "ICE":round2(ice*sign),"IRBPN":round2(irbpn*sign),"PROPINA":round2(prop*sign),
    "TOTAL":round2(total*sign),"DIFERENCIA":round2((total-round2(bn+iva+ice+irbpn+prop))*sign)
  };
}
function normVentaSRI(raw){
  const f=parseFecha(raw['Fecha Emisión'],true);
  const baseExe=numOrZero(raw['Base Exenta de IVA']), baseNo=numOrZero(raw['Base No Objeto de IVA']);
  const b0=numOrZero(raw['Base Tarifa 0']), b5=numOrZero(raw['Base Tarifa 5%']), b15=numOrZero(raw['Base Tarifa 15%']);
  const iva=round2(numOrZero(raw['Monto IVA 5%'])+numOrZero(raw['Monto IVA 15%']));
  const bn=round2(baseExe+baseNo+b0+b5+b15);
  const ice=numOrZero(raw['Monto ICE']), irbpn=numOrZero(raw['Monto IRBPNR']), prop=numOrZero(raw['Propina']);
  const total=numOrZero(raw['Importe Total']);
  return {
    "FECHA EMISION":f,"FECHA AUT":parseFecha(raw['Fecha Autorización'],false),"PERIODO":f.slice(0,7),
    "RUC RECEPTOR":idTexto(raw['No. Id. Receptor']),"RAZON SOCIAL RECEPTOR":String(raw['Razón Social Receptor']||'').trim(),
    "TIPO COMPROBANTE":String(raw['Tipo de Comprobante']||'').trim(),"NO DOCUMENTO":String(raw['No. de Documento']||'').trim(),
    "AUTORIZACION":idTexto(raw['Autorización']),"BASE NOOBJ":baseNo,"BASE EXIVA":baseExe,"BASECERO":b0,
    "BASE5":b5,"BASE15":b15,"IVA":iva,"BASENETA":bn,"ICE":ice,"IRBPN":irbpn,"PROPINA":prop,
    "DESCUENTO":numOrZero(raw['Total Descuento']),"TOTAL":total,
    "DIFERENCIA":round2(total-round2(bn+iva+ice+irbpn+prop))
  };
}
function sumaRet(raw,pref){ let t=0; for(let i=1;i<=10;i++){ const k=pref+i; if(raw[k]!=null&&raw[k]!=='') t+=numOrZero(raw[k]); } return round2(t); }
function normRetSRI(raw){
  const f=parseFecha(raw['Fecha Emisión'],true);
  const no=[String(raw['Establecimiento']||'').trim(),String(raw['Punto Emisión']||'').trim(),String(raw['Secuencial']||'').trim()].filter(Boolean).join('-');
  return {
    "FECHA EMISION":f,"FECHA AUT":parseFecha(raw['Fecha Autorización'],false),"PERIODO":f.slice(0,7),
    "AGENTE RETENCION":String(raw['Raz. Social Ag. Retención']||'').trim(),"RUC AGENTE":idTexto(raw['No. Id Age. Ret.']),
    "SUJETO RETENIDO":String(raw['Raz. Social Sujeto Retenido']||'').trim(),"NO COMPROBANTE":no,
    "AUTORIZACION":idTexto(raw['Autorización']),"DOCUMENTO SUSTENTO":String(raw['Documento Sustento']||'').trim(),
    "VALOR RET RENTA":sumaRet(raw,'Valor Ret. Renta #'),"VALOR RET IVA":sumaRet(raw,'Valor Ret. IVA #'),
    "ESTADO":String(raw['Estado']||'AUTORIZADO').trim()
  };
}
function normLegacy(raw){
  const f=parseFecha(raw['FECHA EMISION'],true);
  return {
    "FECHA EMISION":f,"FECHA AUT":parseFecha(raw['FECHA AUT'],false),"RUC EMISOR":idTexto(raw['RUC EMISOR']),
    "RAZON SOCIAL EMISOR":String(raw['RAZON SOCIAL EMISOR']||'').trim(),
    "PERIODO":String(raw['PERIODO']||'').trim()||f.slice(0,7),"TIPODOC":raw['TIPODOC']||'FAC',
    "CUENTA":String(raw['CUENTA']||'').trim().toUpperCase(),"RESUMEN":String(raw['RESUMEN']||'').trim(),
    "NO COMPROBANTE":String(raw['NO COMPROBANTE']||'').trim(),"AUTORIZACION":idTexto(raw['AUTORIZACION']),
    "BASE NOOBJ":numOrZero(raw['BASE NOOBJ']),"BASE EXIVA":numOrZero(raw['BASE EXIVA']),
    "BASECERO":numOrZero(raw['BASECERO']),"BASE5":numOrZero(raw['BASE5']),"BASE15":numOrZero(raw['BASE15']),
    "IVA":numOrZero(raw['IVA']),"BASENETA":numOrZero(raw['BASENETA']),"ICE":numOrZero(raw['ICE']),
    "IRBPN":numOrZero(raw['IRBPN']),"PROPINA":numOrZero(raw['PROPINA']),"TOTAL":numOrZero(raw['TOTAL']),
    "DIFERENCIA":numOrZero(raw['DIFERENCIA'])
  };
}

/* --- lector de hoja --- */
function readSheet(file, preferidas){
  return new Promise((res,rej)=>{
    if(typeof XLSX==='undefined') return rej(new Error('No se pudo cargar el lector de Excel. Verifica tu conexión.'));
    const name=(file.name||'').toLowerCase();
    if(!/\.(xlsx|xls|xlsm|xlsb|csv|ods)$/.test(name)) return rej(new Error('El archivo no parece ser un Excel válido. Usa .xlsx, .xls, .csv u .ods.'));
    const r=new FileReader();
    r.onload=e=>{
      try{
        const data=new Uint8Array(e.target.result);
        let wb;
        try{ wb=XLSX.read(data,{type:'array',cellDates:true}); }
        catch(err1){
          const text=new TextDecoder().decode(data).trim();
          if(text.startsWith('<')||text.startsWith('<?xml')){
            wb=XLSX.read(text,{type:'string',cellDates:true});
          } else { throw err1; }
        }
        const name=wb.SheetNames.find(n=>preferidas.includes(n))||wb.SheetNames[0];
        if(!name) return rej(new Error('El Excel no contiene hojas legibles.'));
        res(XLSX.utils.sheet_to_json(wb.Sheets[name],{defval:'',raw:true}));
      }catch(err){ rej(new Error('No se pudo leer el Excel. Usa el reporte del SRI sin modificar su formato. Detalle: '+err.message)); }
    };
    r.onerror=()=>rej(new Error('No se pudo abrir el archivo.'));
    r.readAsArrayBuffer(file);
  });
}

/* --- XML / ZIP --- */
const esXmlZip = f => /\.(xml|zip)$/i.test(f.name||'');
function stripXmlns(xmlText){
  return xmlText.replace(/\s+xmlns=["'][^"']*["']/g,'');
}

async function leerXmls(files){
  const textos=[];
  for(const f of files){
    if(/\.zip$/i.test(f.name)){
      if(typeof JSZip==='undefined') throw new Error('No se pudo cargar el lector de ZIP. Verifica tu conexión.');
      const zip=await JSZip.loadAsync(f);
      for(const e of Object.values(zip.files)) if(!e.dir && /\.xml$/i.test(e.name)) textos.push(await e.async('string'));
    } else if(/\.xml$/i.test(f.name)) textos.push(await f.text());
  }
  const parser=new DOMParser(), out=[];
  textos.forEach(t=>{
    try{
      let doc=parser.parseFromString(stripXmlns(t),'text/xml');
      if(doc.querySelector('parsererror')) return;
      const c=doc.querySelector('comprobante');
      if(c && /<(factura|notaCredito|comprobanteRetencion)[\s>]/.test(c.textContent)){
        const i=parser.parseFromString(stripXmlns(c.textContent),'text/xml');
        if(!i.querySelector('parsererror')) doc=i;
      }
      const raiz=doc.documentElement?doc.documentElement.tagName:'';
      if(['factura','notaCredito','comprobanteRetencion'].includes(raiz)) out.push({tipo:raiz,doc});
    }catch(e){}
  });
  return out;
}
const xv=(d,s)=>{ const e=d.querySelector(s); return e?e.textContent.trim():''; };
const xn=(d,s)=>numOrZero(xv(d,s));
const xfecha=s=>{ const m=String(s||'').match(/^(\d{2})\/(\d{2})\/(\d{4})/); return m?`${m[3]}-${m[2]}-${m[1]}`:''; };
function basesXml(doc,sel){
  const b={exe:0,noObj:0,b0:0,b5:0,b15:0,iva:0};
  doc.querySelectorAll(sel).forEach(i=>{
    const cp=xv(i,'codigoPorcentaje'), base=xn(i,'baseImponible'), val=xn(i,'valor');
    if(cp==='0') b.b0+=base; else if(cp==='6') b.noObj+=base; else if(cp==='7') b.exe+=base;
    else if(cp==='5') b.b5+=base; else b.b15+=base;
    b.iva+=val;
  });
  return b;
}
const xmlNoDoc = d => [xv(d,'infoTributaria > estab'),xv(d,'infoTributaria > ptoEmi'),xv(d,'infoTributaria > secuencial')].filter(Boolean).join('-');
function xmlFacturaCompra(d){
  const f=xfecha(xv(d,'infoFactura > fechaEmision')), b=basesXml(d,'infoFactura > totalConImpuestos > totalImpuesto');
  const bn=round2(b.exe+b.noObj+b.b0+b.b5+b.b15), prop=xn(d,'infoFactura > propina'), total=xn(d,'infoFactura > importeTotal');
  const desc=xv(d,'detalles > detalle > descripcion');
  return {"FECHA EMISION":f,"FECHA AUT":'',"RUC EMISOR":xv(d,'infoTributaria > ruc'),
    "RAZON SOCIAL EMISOR":xv(d,'infoTributaria > razonSocial'),"PERIODO":f.slice(0,7),"TIPODOC":'FAC',
    "CUENTA":autoClasificarSRI('',desc),"RESUMEN":desc||'Importado desde XML · pendiente de clasificar',
    "NO COMPROBANTE":xmlNoDoc(d),"AUTORIZACION":xv(d,'infoTributaria > claveAcceso'),
    "BASE NOOBJ":b.noObj,"BASE EXIVA":b.exe,"BASECERO":b.b0,"BASE5":b.b5,"BASE15":b.b15,"IVA":round2(b.iva),
    "BASENETA":bn,"ICE":0,"IRBPN":0,"PROPINA":prop,"TOTAL":total,"DIFERENCIA":round2(total-round2(bn+b.iva+prop))};
}
function xmlFacturaVenta(d){
  const f=xfecha(xv(d,'infoFactura > fechaEmision')), b=basesXml(d,'infoFactura > totalConImpuestos > totalImpuesto');
  const bn=round2(b.exe+b.noObj+b.b0+b.b5+b.b15), prop=xn(d,'infoFactura > propina'), total=xn(d,'infoFactura > importeTotal');
  return {"FECHA EMISION":f,"FECHA AUT":'',"PERIODO":f.slice(0,7),
    "RUC RECEPTOR":xv(d,'infoFactura > identificacionComprador'),
    "RAZON SOCIAL RECEPTOR":xv(d,'infoFactura > razonSocialComprador'),"TIPO COMPROBANTE":'FACTURA',
    "NO DOCUMENTO":xmlNoDoc(d),"AUTORIZACION":xv(d,'infoTributaria > claveAcceso'),
    "BASE NOOBJ":b.noObj,"BASE EXIVA":b.exe,"BASECERO":b.b0,"BASE5":b.b5,"BASE15":b.b15,"IVA":round2(b.iva),
    "BASENETA":bn,"ICE":0,"IRBPN":0,"PROPINA":prop,"DESCUENTO":xn(d,'infoFactura > totalDescuento'),
    "TOTAL":total,"DIFERENCIA":round2(total-round2(bn+b.iva+prop))};
}
function xmlNotaCredito(d){
  const f=xfecha(xv(d,'infoNotaCredito > fechaEmision')), b=basesXml(d,'infoNotaCredito > totalConImpuestos > totalImpuesto');
  const bn=round2(b.exe+b.noObj+b.b0+b.b5+b.b15), total=xn(d,'infoNotaCredito > valorModificacion');
  const mod=xv(d,'infoNotaCredito > numDocModificado'), desc=xv(d,'detalles > detalle > descripcion');
  return {"FECHA EMISION":f,"FECHA AUT":'',"RUC EMISOR":xv(d,'infoTributaria > ruc'),
    "RAZON SOCIAL EMISOR":xv(d,'infoTributaria > razonSocial'),"PERIODO":f.slice(0,7),"TIPODOC":'NC',
    "CUENTA":autoClasificarSRI('',desc),
    "RESUMEN":'[NOTA DE CRÉDITO] '+(mod?('Modifica factura N° '+mod+'. '):'')+(desc||''),
    "NO COMPROBANTE":'NC-'+xmlNoDoc(d),"AUTORIZACION":xv(d,'infoTributaria > claveAcceso'),
    "BASE NOOBJ":-b.noObj,"BASE EXIVA":-b.exe,"BASECERO":-b.b0,"BASE5":-b.b5,"BASE15":-b.b15,
    "IVA":round2(-b.iva),"BASENETA":round2(-bn),"ICE":0,"IRBPN":0,"PROPINA":0,"TOTAL":round2(-total),
    "DIFERENCIA":round2(-(total-round2(bn+b.iva)))};
}
function xmlRetencion(d){
  const f=xfecha(xv(d,'infoCompRetencion > fechaEmision'));
  let ir=0,iv=0,sust='';
  d.querySelectorAll('impuestos > impuesto, docsSustento retencion').forEach(i=>{
    const cod=xv(i,'codigo'), val=numOrZero(xv(i,'valorRetenido'));
    if(cod==='1') ir+=val; else if(cod==='2') iv+=val;
    if(!sust) sust=xv(i,'numDocSustento');
  });
  if(!sust) sust=xv(d,'docsSustento docSustento numDocSustento');
  return {"FECHA EMISION":f,"FECHA AUT":'',"PERIODO":f.slice(0,7),
    "AGENTE RETENCION":xv(d,'infoTributaria > razonSocial'),"RUC AGENTE":xv(d,'infoTributaria > ruc'),
    "SUJETO RETENIDO":xv(d,'infoCompRetencion > razonSocialSujetoRetenido'),"NO COMPROBANTE":xmlNoDoc(d),
    "AUTORIZACION":xv(d,'infoTributaria > claveAcceso'),"DOCUMENTO SUSTENTO":sust,
    "VALOR RET RENTA":round2(ir),"VALOR RET IVA":round2(iv),"ESTADO":'AUTORIZADO'};
}

/* --- Handlers --- */
async function handleImportCompras(ev){
  const files=[...(ev.target.files||[])]; ev.target.value=''; if(!files.length) return;
  try{
    let rows;
    if(files.some(esXmlZip)){
      const docs=await leerXmls(files), fac=docs.filter(d=>d.tipo==='factura');
      if(docs.length-fac.length) showToast(`Se omitieron ${docs.length-fac.length} comprobante(s) que no son facturas`);
      if(!fac.length) return showToast('No se encontraron facturas válidas','err');
      rows=fac.map(f=>xmlFacturaCompra(f.doc));
    } else rows=(await readSheet(files[0],['Compras'])).map(r=>normCompraSRI(r,1,false));
    rows=rows.filter(r=>r['NO COMPROBANTE']);
    const omC=rows.length; rows=rows.filter(r=>!esCedula10(r['RUC EMISOR']));
    if(omC>rows.length) showToast(`Se omitieron ${omC-rows.length} compra(s) con cédula (10 dígitos).`);
    procesarCompras(rows);
  }catch(e){ showToast(e.message,'err'); }
}
async function handleImportNC(ev){
  const files=[...(ev.target.files||[])]; ev.target.value=''; if(!files.length) return;
  try{
    let rows;
    if(files.some(esXmlZip)){
      const docs=await leerXmls(files), nc=docs.filter(d=>d.tipo==='notaCredito');
      if(!nc.length) return showToast('No se encontraron notas de crédito válidas','err');
      rows=nc.map(f=>xmlNotaCredito(f.doc));
    } else rows=(await readSheet(files[0],['Notas de Crédito','Notas de Credito'])).map(r=>normCompraSRI(r,-1,true));
    rows=rows.filter(r=>r['NO COMPROBANTE']);
    const omN=rows.length; rows=rows.filter(r=>!esCedula10(r['RUC EMISOR']));
    if(omN>rows.length) showToast(`Se omitieron ${omN-rows.length} nota(s) de crédito con cédula (10 dígitos).`);
    procesarCompras(rows);
  }catch(e){ showToast(e.message,'err'); }
}
async function handleImportVentas(ev){
  const files=[...(ev.target.files||[])]; ev.target.value=''; if(!files.length) return;
  try{
    let rows;
    if(files.some(esXmlZip)){
      const docs=await leerXmls(files), fac=docs.filter(d=>d.tipo==='factura');
      if(!fac.length) return showToast('No se encontraron facturas válidas','err');
      rows=fac.map(f=>xmlFacturaVenta(f.doc));
    } else rows=(await readSheet(files[0],['Facturas','Ventas'])).map(normVentaSRI);
    rows=rows.filter(r=>r['NO DOCUMENTO']);
    const nuevas=dedupe(rows,RAW_VENTAS,r=>r['NO DOCUMENTO']);
    if(!nuevas.acc.length) return alert(`No se importó ninguna factura nueva: las ${nuevas.dup} ya existían.`);
    RAW_VENTAS=RAW_VENTAS.concat(nuevas.acc); afterVentasChange(); renderVentas();
    alert(`Ventas importadas.\n\nNuevas: ${nuevas.acc.length}\nDuplicadas omitidas: ${nuevas.dup}`);
  }catch(e){ showToast(e.message,'err'); }
}
async function handleImportRetenciones(ev){
  const files=[...(ev.target.files||[])]; ev.target.value=''; if(!files.length) return;
  try{
    let rows;
    if(files.some(esXmlZip)){
      const docs=await leerXmls(files), ret=docs.filter(d=>d.tipo==='comprobanteRetencion');
      if(!ret.length) return showToast('No se encontraron comprobantes de retención','err');
      rows=ret.map(f=>xmlRetencion(f.doc));
    } else rows=(await readSheet(files[0],['Retenciones'])).map(normRetSRI);
    rows=rows.filter(r=>r.AUTORIZACION||r['NO COMPROBANTE']);
    const n=dedupe(rows,RAW_RET,r=>r.AUTORIZACION||r['NO COMPROBANTE']);
    if(!n.acc.length) return alert(`No se importó ninguna retención nueva: las ${n.dup} ya existían.`);
    RAW_RET=RAW_RET.concat(n.acc); afterRetChange(); renderRetenciones();
    alert(`Retenciones importadas.\n\nNuevas: ${n.acc.length}\nDuplicadas omitidas: ${n.dup}`);
  }catch(e){ showToast(e.message,'err'); }
}
async function handleImportLegacy(ev){
  const f=ev.target.files&&ev.target.files[0]; ev.target.value=''; if(!f) return;
  try{
    let rows=(await readSheet(f,['Doc'])).map(normLegacy).filter(r=>r['NO COMPROBANTE']);
    if(!rows.length) return showToast('No se encontraron filas válidas (falta "NO COMPROBANTE")','err');
    const omL=rows.length; rows=rows.filter(r=>!esCedula10(r['RUC EMISOR']));
    if(omL>rows.length) showToast(`Se omitieron ${omL-rows.length} registro(s) con cédula (10 dígitos).`);
    procesarCompras(rows);
  }catch(e){ showToast(e.message,'err'); }
}
function dedupe(rows, base, keyFn){
  const ex=new Set(base.map(d=>String(keyFn(d)||'').trim())), seen=new Set(), acc=[]; let dup=0;
  rows.forEach(r=>{ const k=String(keyFn(r)||'').trim(); if(!k||ex.has(k)||seen.has(k)){dup++;return;} seen.add(k); acc.push(r); });
  return {acc,dup};
}
function procesarCompras(rows){
  if(!rows.length) return showToast('El archivo no contiene comprobantes válidos','err');
  const {acc,dup}=dedupe(rows,RAW_COMPRAS,r=>r['NO COMPROBANTE']);
  if(!acc.length) return alert(`No se importó ningún registro nuevo: los ${dup} del archivo ya existían.`);
  const nuevas=[...new Set(acc.map(r=>r.CUENTA).filter(c=>c&&!CUENTA_MAP[c]))].sort();
  PENDING_IMPORT=acc; PENDING_STATS={dup,total:rows.length};
  if(nuevas.length){
    document.getElementById('cuentas-nuevas-list').innerHTML=nuevas.map(c=>`<div style="padding:5px 0;border-bottom:1px solid var(--border)">• ${esc(c)}</div>`).join('');
    openModal('modal-cuentas-nuevas');
  } else finalizeImport();
}
function cancelImportWithNewAccounts(){ PENDING_IMPORT=null; PENDING_STATS=null; closeModal('modal-cuentas-nuevas'); }
function continueImportWithNewAccounts(){ closeModal('modal-cuentas-nuevas'); finalizeImport(); }
function finalizeImport(){
  if(!PENDING_IMPORT) return;
  const acc=PENDING_IMPORT, st=PENDING_STATS||{dup:0};
  RAW_COMPRAS=RAW_COMPRAS.concat(acc);
  PENDING_IMPORT=null; PENDING_STATS=null;
  afterComprasChange();
  alert(`Importación completada.\n\nRegistros nuevos: ${acc.length}\nDuplicados omitidos: ${st.dup}`);
}

/* --- Eliminación por período --- */
function openDeleteModal(){
  const sel=document.getElementById('del-periodo-select');
  sel.innerHTML=`<option value="__ALL__">TODOS los períodos (${DATA.length} registros)</option>`+
    periodosDisponibles().map(p=>`<option value="${esc(p)}">${esc(periodLabel(p))} (${DATA.filter(d=>d.PERIODO===p).length})</option>`).join('');
  updateDeleteInfo(); openModal('modal-eliminar');
}
function updateDeleteInfo(){
  const v=document.getElementById('del-periodo-select').value;
  const c=v==='__ALL__'?DATA.length:DATA.filter(d=>d.PERIODO===v).length;
  document.getElementById('del-info').textContent=`Se eliminarán ${c} registro(s) de compras y sus asientos automáticos. Los asientos manuales, ajustes y el plan de cuentas no se modifican.`;
}
function confirmDelete(){
  const v=document.getElementById('del-periodo-select').value;
  const c=v==='__ALL__'?DATA.length:DATA.filter(d=>d.PERIODO===v).length;
  if(!c) return alert('No hay registros para eliminar en ese período.');
  if(!confirm(`?Eliminar ${c} registro(s) de ${v==='__ALL__'?'TODOS los períodos':periodLabel(v)}? No se puede deshacer.`)) return;
  RAW_COMPRAS = v==='__ALL__' ? [] : RAW_COMPRAS.filter(d=>d.PERIODO!==v);
  afterComprasChange(); closeModal('modal-eliminar');
  alert(`Se eliminaron ${c} registro(s).`);
}
function deleteVentas(){
  const p=document.getElementById('vt-periodo').value;
  const c=p?DATA_VENTAS.filter(v=>v.PERIODO===p).length:DATA_VENTAS.length;
  if(!c) return alert('No hay ventas para eliminar.');
  if(!confirm(`?Eliminar ${c} factura(s) de venta de ${p?periodLabel(p):'TODOS los períodos'}?`)) return;
  RAW_VENTAS = p?RAW_VENTAS.filter(v=>v.PERIODO!==p):[];
  afterVentasChange(); renderVentas(); showToast(`Se eliminaron ${c} factura(s)`);
}
function deleteRetenciones(){
  const p=document.getElementById('ret-periodo').value;
  const c=p?DATA_RETENCIONES.filter(r=>r.PERIODO===p).length:DATA_RETENCIONES.length;
  if(!c) return alert('No hay retenciones para eliminar.');
  if(!confirm(`?Eliminar ${c} comprobante(s) de retención?`)) return;
  RAW_RET = p?RAW_RET.filter(r=>r.PERIODO!==p):[];
  afterRetChange(); renderRetenciones(); showToast(`Se eliminaron ${c} comprobante(s)`);
}

/* Auto-expose window */
window.cancelImportWithNewAccounts = cancelImportWithNewAccounts;
window.confirmDelete = confirmDelete;
window.continueImportWithNewAccounts = continueImportWithNewAccounts;
window.deleteRetenciones = deleteRetenciones;
window.deleteVentas = deleteVentas;
window.handleImportCompras = handleImportCompras;
window.handleImportLegacy = handleImportLegacy;
window.handleImportNC = handleImportNC;
window.handleImportRetenciones = handleImportRetenciones;
window.handleImportVentas = handleImportVentas;
window.openDeleteModal = openDeleteModal;
window.updateDeleteInfo = updateDeleteInfo;
