# Inventario lógico de migraciones

Revisión Fase 1. Este documento no ejecuta ni reemplaza migraciones. El orden indicado es lógico, no confirma el orden aplicado en producción. Antes de consolidar debe compararse `pg_catalog`, funciones vigentes y `control_migraciones` de la base desplegada.

Leyenda: **base** crea la capacidad; **evolución** agrega campos/reglas; **redefine** sustituye una RPC anterior; **final probable** es la última implementación encontrada por tema; **operativa** modifica datos y requiere revisión manual.

| Orden | Archivo | Tablas / RPC afectadas | Dependencias | Relación / estado probable |
|---:|---|---|---|---|
| 1 | `migracion_sesiones.sql` | sesiones | auth.users | base de sesiones |
| 2 | `increment_secuencial.sql` | increment_secuencial, puntos_emision | puntos_emision base ausente | base RPC; redefinida después |
| 3 | `migracion_crear_venta_atomica.sql` | crear_venta, comprobantes, items, inventario | tablas núcleo ausentes | base RPC; redefinida después |
| 4 | `migracion_caja.sql` | cajas, movimientos_caja, cerrar_caja | emisores | base; RPC redefinida después |
| 5 | `migracion_inventario_entradas_ajustes.sql` | registrar_entrada/ajuste_inventario | productos, movimientos_inventario | base RPC de inventario |
| 6 | `migracion_proveedores_cxp_cxc.sql` | proveedores, CxP/CxC y pagos; RPC de pagos/entrada | emisores, clientes, inventario | base ERP; entrada redefinida |
| 7 | `migracion_configuracion_documentos_notificaciones.sql` | configuracion_sistema, documentos_sri_borrador | emisores/clientes | base documentos/configuración |
| 8 | `migracion_email_envios.sql` | email_envios | comprobantes | base de historial correo |
| 9 | `migracion_archivo_comprobantes_storage.sql` | comprobante_archivos, trigger touch | comprobantes, Storage | base archivo comprobante |
| 10 | `migracion_saas_proveedor_v960.sql` | planes, suscripciones, pagos, proveedores_admin | emisores | base SaaS |
| 11 | `migracion_saas_v970.sql` | cuentas/contribuyentes SaaS, ATS | base SaaS, emisores | evolución SaaS + base ATS |
| 12 | `migracion_pago_saas_payphone_v958.sql` | pagos_solicitud_saas, solicitudes registro | planes/solicitudes | base PayPhone |
| 13 | `migracion_saas_registro_control_v9926.sql` | solicitudes_registro_saas | planes | base/evolución registro público |
| 14 | `migracion_planes_comerciales_v956.sql` | planes_suscripcion | base SaaS | evolución límites/precios |
| 15 | `migracion_catalogo_planes_v960.sql` | planes_suscripcion | base SaaS | catálogo comercial; datos |
| 16 | `migracion_saas_registro_control_v9926.sql` | solicitudes registro | planes | control de altas; verificar aplicación única |
| 17 | `migracion_notificaciones_profesionales_v93.sql` | notificaciones_leidas | auth.users, emisores | base notificaciones UI |
| 18 | `migracion_v947_clientes_establecimientos_permisos.sql` | clientes índices, establecimientos, permisos | tablas núcleo/auth | evolución multiestablecimiento/RBAC |
| 19 | `migracion_configuracion_estructura_v972.sql` | establecimientos_emisor | establecimiento base | evolución de estructura |
| 20 | `migracion_certificados_cifrados.sql` | certificados | certificados base ausente | evolución cifrado AES |
| 21 | `migracion_certificado_unico_por_alias.sql` | certificados | anterior | unicidad por alias |
| 22 | `migracion_firma_electronica_autoservicio_v997.sql` | certificados/configuración | cifrado, emisores | evolución autoservicio |
| 23 | `migracion_v9972_certificados_compatibilidad.sql` | certificados | anteriores | reparación compatibilidad; final probable certificados |
| 24 | `migracion_documentos_sri_v952.sql` | documentos_sri_borrador | configuración documentos | evolución documentos SRI |
| 25 | `migracion_sri_cumplimiento_v9.sql` | secuenciales, documentos, auditoría, anulaciones | núcleo/documentos | redefine increment_secuencial |
| 26 | `migracion_auditoria_v950.sql` | auditoria_sri | auditoría SRI | evolución trazabilidad |
| 27 | `migracion_anulacion_facturas_v971.sql` | solicitudes_anulacion_sri, comprobantes | comprobantes | evolución anulaciones |
| 28 | `migracion_secuencial_nulo.sql` | comprobantes | comprobantes | compatibilidad secuencial |
| 29 | `migracion_iva_5_porciento.sql` | crear_venta | RPC venta base | redefine crear_venta |
| 30 | `migracion_iva_8_porciento_turismo.sql` | crear_venta | anterior | redefine crear_venta |
| 31 | `migracion_iva_v995_correccion_15.sql` | configuración/productos IVA | núcleo | corrección normativa |
| 32 | `migracion_iva_dinamico_saas_v980.sql` | configuracion_iva, impuestos, RPC registro | comprobantes/planes | base IVA dinámico |
| 33 | `migracion_v990_motor_tributario_saas.sql` | catálogo IVA, configuración, facturas SaaS | IVA/SaaS | evolución tributaria SaaS |
| 34 | `migracion_v996_estabilizacion_total.sql` | IVA, contabilidad, crear_venta | múltiples bases | redefine crear_venta; versión puente |
| 35 | `migracion_contsertrib_v9922_iva_normativa.sql` | catálogo/configuración IVA | motor tributario | evolución normativa |
| 36 | `migracion_contsertrib_v9925_iva_general_15.sql` | configuración IVA | anterior | fija regla general 15%; no alterar comercialmente |
| 37 | `migracion_contsertrib_v9941_iva_maestro_decretos.sql` | decretos/promociones IVA | configuración IVA/ROOT | final probable motor IVA |
| 38 | `migracion_alertas_inventario_semaforo.sql` | productos | productos base | evolución alertas |
| 39 | `migracion_inventario_bodegas_v9963.sql` | bodegas/existencias, transferir | inventario base | base multibodega |
| 40 | `migracion_inventario_erp_v9964.sql` | ubicaciones/reservas y RPC | bodegas | evolución multibodega; final probable |
| 41 | `migracion_motor_contable_v994.sql` | plan/asientos/lineas | emisores | primera base contable |
| 42 | `migracion_motor_contable_v998_completo.sql` | contabilidad/RPC asiento/cierre | anterior | redefine motor contable |
| 43 | `migracion_contabilidad_completa_v9911.sql` | contabilidad, nómina, RPC | emisores/auth | nueva base/redefine |
| 44 | `migracion_contabilidad_completa_v9912_reparacion.sql` | mismas tablas/RPC | v9911 | reparación de instalaciones antiguas |
| 45 | `migracion_contabilidad_completa_v9913.sql` | tablas contables | anteriores | reparación/evolución |
| 46 | `migracion_contabilidad_completa_v9914.sql` | contabilidad/nómina | anteriores | reparación/evolución |
| 47 | `migracion_contsertrib_v9918_integridad_filtros.sql` | índices, editar_asiento RPC | contabilidad/caja | evolución e introduce edición atómica |
| 48 | `migracion_contsertrib_v9920_estabilidad.sql` | crear_asiento/periodo RPC | contabilidad | redefine RPC; versión posterior |
| 49 | `migracion_v91011_motor_contable_integrado.sql` | vínculos CxP/CxC/documentos/nómina, sincronizaciones | todos módulos contables | redefine crear_asiento; integración |
| 50 | `migracion_v91012_nomina_reportes_asientos.sql` | eliminar_asiento_manual RPC | contabilidad | final probable eliminación manual |
| 51 | `migracion_v99190_reparacion_nomina_contabilidad_auto.sql` | nómina/asientos/índices | contabilidad integrada | reparación final probable nómina |
| 52 | `migracion_contsertrib_v9921_comprobantes_sri_archivos_email.sql` | documentos/archivos/email | SRI/Storage/Resend | integración comprobantes |
| 53 | `migracion_contsertrib_v9923_logo_ride.sql` | configuración/logo | configuracion_sistema | evolución RIDE |
| 54 | `migracion_reportes_ride_caja_v974.sql` | cerrar_caja/reportes | caja/comprobantes | redefine cerrar_caja; final probable caja |
| 55 | `migracion_v997_ticket_pos_integrado.sql` | secuencial ticket/crear venta | POS/núcleo | redefine secuencial/venta |
| 56 | `migracion_v998_ticket_estado_fix.sql` | estado comprobante/crear_venta | ticket integrado | redefine crear_venta; posterior |
| 57 | `migracion_v9999_ticket_pos_panel_maestro.sql` | planes/emisores ticket | SaaS/POS | control ROOT ticket |
| 58 | `migracion_v9100_ticket_pos_por_contribuyente.sql` | emisores ticket | anterior | final probable habilitación ticket |
| 59 | `migracion_v9100_reparacion_listado_ventas.sql` | índices comprobantes/clientes | núcleo | optimización reportes |
| 60 | `migracion_proveedores_cxp_cxc.sql` | pagos RPC | ERP base | RPC redefinidas más adelante |
| 61 | `migracion_v9974_auditoria_integral_erp.sql` | índices/unicidad/RPC pagos | ERP/PayPhone | redefine pagos CxP/CxC; robustez |
| 62 | `migracion_v9978_direccion_establecimiento_sri.sql` | establecimientos/documentos | SRI | cumplimiento dirección |
| 63 | `migracion_v9979_cumplimiento_sri.sql` | configuración/documentos | anteriores | cumplimiento posterior |
| 64 | `migracion_v9980_payphone_produccion.sql` | índices PayPhone | pagos_solicitud_saas | unicidad transaction_id; vigente |
| 65 | `migracion_v9982_promociones_maestro.sql` | promociones_saas | SaaS/ROOT | promociones comerciales; conservar |
| 66 | `migracion_v9983_saas_payphone_resend_definitivo.sql` | pagos/solicitudes/notificación | PayPhone/Resend | evolución flujo |
| 67 | `migracion_v9984_PAYPHONE_RESEND_ROBUSTEZ.sql` | pagos/solicitudes | anterior | final probable PayPhone previo a Fase 1 |
| 68 | `migracion_v9985_saas_payphone_flujo_definitivo.sql` | SaaS/PayPhone | anteriores | flujo posterior; comparar con 9984 |
| 69 | `migracion_contsertrib_v9928_seguridad_onboarding.sql` | onboarding/cuentas | SaaS/Auth | seguridad de alta |
| 70 | `migracion_contsertrib_v9929_notificaciones_root.sql` | configuración ROOT | SaaS/Resend | evolución notificaciones |
| 71 | `migracion_contsertrib_v9937_seguridad_procesamiento_sri.sql` | documentos SRI | documentos | bloqueo/reparación procesamiento |
| 72 | `migracion_contsertrib_v9938_seguridad_procesamiento_sri.sql` | documentos + trigger touch | 9937 | final probable seguridad SRI |
| 73 | `migracion_v9103_panel_maestro_planes_modulos_solicitudes.sql` | planes/solicitudes | SaaS/ROOT | final probable módulos de planes |
| 74 | `migracion_v9104_envio_automatico_facturas_sri.sql` | email_envios/documentos | correo/SRI | evolución envío automático |
| 75 | `migracion_v9105_auditoria_integral_integridad.sql` | índices de integridad | certificados/SaaS/comprobantes/inventario | última optimización general |
| 76 | `migracion_v9965_plan_erp_completo_empresa_prueba.sql` | planes/empresa fixture | SaaS completo | operativa; no ejecutar en producción sin revisión |
| 77 | `RESET_DATOS_PRUEBAS_NO_DESTRUCTIVO_v9.9.51.sql` | múltiples datos de prueba | esquema completo | operativa, no es migración de despliegue |

## Observaciones críticas

- El directorio contiene 75 archivos SQL en total, incluido el script operativo de reset; la tabla repite dos archivos en su posición temática para evidenciar que participan en más de una cadena. No deben ejecutarse literalmente siguiendo esta numeración.
- Falta el esquema base de las tablas núcleo. Ninguna secuencia puede bootstrappear una base vacía todavía.
- `crear_venta`, `increment_secuencial`, `cerrar_caja`, `crear_asiento_contable_atomico`, `registrar_entrada_inventario` y las RPC de pagos tienen varias definiciones. La firma vigente debe extraerse de producción antes de consolidar.
- No se creó SQL correctivo en Fase 1: las defensas nuevas se implementan en backend y reutilizan los índices de unicidad PayPhone ya existentes.
- Próximo paso seguro: exportar solo esquema de producción, comparar firmas con `pg_get_functiondef`, consultar índices/constraints y marcar qué archivos constan en `control_migraciones`.
