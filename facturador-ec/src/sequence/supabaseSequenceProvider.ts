import type { DocumentType } from 'facturacion-electronica-ec';
import { supabase } from '../db/supabase.js';

/**
 * Implementación de ISequenceProvider (requerida por facturacion-electronica-ec)
 * respaldada en la tabla `puntos_emision` de setup-supabase-facturador.sql.
 *
 * La librería exige esto explícitamente: "No hay default de producción" —
 * el UnsafeMemorySequenceProvider que trae de fábrica pierde la cuenta al
 * reiniciar el proceso, lo cual sería gravísimo aquí (duplicaría secuenciales
 * de facturas, que el SRI rechazaría o, peor, aceptaría dos veces).
 *
 * Mapeo de columna por tipo de documento (ver tabla puntos_emision):
 *   factura            -> secuencial_factura
 *   nota_credito        -> secuencial_nota_credito
 *   nota_debito         -> secuencial_nota_debito
 *   guia_remision       -> secuencial_guia_remision
 *   COMPROBANTE_RETENCION -> secuencial_retencion
 *   LIQUIDACION_COMPRA    -> reutiliza secuencial_factura (agregar columna
 *                            propia si el negocio real necesita liquidaciones
 *                            con su propia numeración independiente)
 *
 * Nota: el tipo `DocumentType` se importa directamente de la librería
 * (no se redeclara a mano aquí) para que si la librería agrega o renombra
 * un tipo de documento en una futura versión, TypeScript marque en rojo
 * este archivo en vez de fallar en silencio en producción — ya nos pasó
 * una vez con el bug de mayúsculas/minúsculas en nomina.js, así que
 * conviene que el compilador atrape este tipo de desalineación antes de
 * que llegue a producción.
 */

const COLUMNA_POR_TIPO: Record<DocumentType, string> = {
  FACTURA: 'secuencial_factura',
  NOTA_CREDITO: 'secuencial_nota_credito',
  NOTA_DEBITO: 'secuencial_nota_debito',
  GUIA_REMISION: 'secuencial_guia_remision',
  COMPROBANTE_RETENCION: 'secuencial_retencion',
  LIQUIDACION_COMPRA: 'secuencial_factura',
};

export class SupabaseSequenceProvider {
  /**
   * `emisorId` se recibe en el constructor (no en `next()`, porque la
   * interfaz ISequenceProvider de la librería no lo contempla como
   * parámetro) — por eso el servicio en services/facturacion.ts crea una
   * instancia nueva de este proveedor por cada emisor, en vez de reusar una
   * sola instancia global. Es importante: sin esto, dos emisores con el
   * mismo "001"-"001" (el caso más común) compartirían contador.
   */
  constructor(private readonly emisorId: string) {}

  /**
   * Devuelve el siguiente secuencial (9 dígitos, zero-padded) para un
   * establecimiento + punto de emisión + tipo de documento, incrementando
   * el contador de forma atómica en la base de datos.
   *
   * IMPORTANTE: esto usa una función RPC de Postgres (increment_secuencial,
   * ver sql/increment_secuencial.sql) en vez de "leer, sumar 1 en JS, y
   * guardar", porque esa segunda forma tiene una condición de carrera real
   * si dos ventas del mismo punto de emisión llegan casi al mismo tiempo
   * (dos cajeros vendiendo a la vez, por ejemplo) — ambas leerían el mismo
   * número antes de que la primera guarde, y terminarías con dos
   * comprobantes con el mismo secuencial, algo que el SRI rechazaría o que
   * sería un error grave de auditoría si no lo rechazara.
   */
  async next(
    establecimiento: string,
    puntoEmision: string,
    documentType: DocumentType
  ): Promise<string> {
    const columna = COLUMNA_POR_TIPO[documentType];

    const { data, error } = await supabase.rpc('increment_secuencial', {
      p_emisor_id: this.emisorId,
      p_establecimiento: establecimiento,
      p_punto_emision: puntoEmision,
      p_columna: columna,
    });

    if (error) {
      throw new Error(
        `No se pudo obtener el siguiente secuencial (${documentType}, ` +
          `${establecimiento}-${puntoEmision}): ${error.message}`
      );
    }

    const siguiente: number = data;
    return String(siguiente).padStart(9, '0');
  }

  /**
   * Si el SRI devuelve el comprobante (rechazo en recepción, no en
   * autorización), el secuencial queda "quemado" y NO se debe reutilizar
   * — reemitir siempre con el siguiente número, nunca reintentar con el
   * mismo. Por eso este rollback existe pero de momento solo registra la
   * situación; no decrementa el contador. Decrementar contadores en un
   * documento fiscal es arriesgado (puede volver a chocar con otro
   * secuencial ya usado) y el propio README de la librería lo deja como
   * opcional por esta razón.
   */
  async rollback(
    establecimiento: string,
    puntoEmision: string,
    documentType: DocumentType
  ): Promise<void> {
    console.warn(
      `[SupabaseSequenceProvider] rollback solicitado para ${documentType} ` +
        `en ${establecimiento}-${puntoEmision} — no se decrementa el contador ` +
        `a propósito (ver comentario en el código). El secuencial queda quemado.`
    );
  }
}
