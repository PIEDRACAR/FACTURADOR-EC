import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { env } from '../config/env.js';

/**
 * Cifrado simétrico (AES-256-GCM) para secretos que deben vivir en la base
 * de datos: la contraseña del certificado .p12 y el propio archivo .p12.
 *
 * POR QUÉ ESTO EXISTE: la versión anterior de este backend leía la
 * contraseña y el certificado desde variables de entorno con el nombre del
 * emisor (P12_PASSWORD__<alias>, P12_BASE64__<alias>). Eso obligaba a
 * entrar manualmente a Railway/Render a crear una variable nueva cada vez
 * que se registraba un negocio nuevo — imposible de sostener si el
 * registro va a ser autoservicio desde una pantalla web.
 *
 * Con este módulo, en cambio, solo existe UNA variable de entorno para
 * todo el sistema (SECRETS_ENCRYPTION_KEY, una llave maestra de 32 bytes
 * en hexadecimal), y cada certificado/contraseña se cifra con esa llave
 * antes de guardarse en las columnas `certificados.p12_cifrado` y
 * `certificados.p12_password_cifrado` (tipo bytea). El registro de un
 * negocio nuevo ya no requiere tocar Railway para nada.
 *
 * Generar la llave maestra UNA sola vez con:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 * y guardarla como SECRETS_ENCRYPTION_KEY en las variables de entorno del
 * hosting. Si esa llave se pierde, los certificados guardados quedan
 * ilegibles — hay que volver a subirlos.
 */

const ALGORITHM = 'aes-256-gcm';

function obtenerLlave(): Buffer {
  const hex = env.secretsEncryptionKey;
  const llave = Buffer.from(hex, 'hex');
  if (llave.length !== 32) {
    throw new Error(
      `SECRETS_ENCRYPTION_KEY debe ser una cadena hexadecimal de 32 bytes (64 caracteres). ` +
        `Longitud actual tras decodificar: ${llave.length} bytes.`
    );
  }
  return llave;
}

/**
 * Cifra un Buffer arbitrario (contraseña como texto convertido a Buffer, o
 * el archivo .p12 completo) y devuelve un solo Buffer que junta el IV, el
 * tag de autenticación GCM y el contenido cifrado, en ese orden — así una
 * sola columna `bytea` alcanza para guardar todo lo necesario para
 * descifrar después.
 */
export function cifrar(datos: Buffer): Buffer {
  const iv = randomBytes(12); // 96 bits, tamaño recomendado para GCM
  const cipher = createCipheriv(ALGORITHM, obtenerLlave(), iv);
  const cifrado = Buffer.concat([cipher.update(datos), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, cifrado]);
}

export function cifrarTexto(texto: string): Buffer {
  return cifrar(Buffer.from(texto, 'utf-8'));
}

/** Inverso de `cifrar`: separa IV + authTag + contenido y descifra. */
export function descifrar(paquete: Buffer): Buffer {
  const iv = paquete.subarray(0, 12);
  const authTag = paquete.subarray(12, 28);
  const cifrado = paquete.subarray(28);

  const decipher = createDecipheriv(ALGORITHM, obtenerLlave(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(cifrado), decipher.final()]);
}

export function descifrarTexto(paquete: Buffer): string {
  return descifrar(paquete).toString('utf-8');
}

/**
 * Supabase/PostgREST representa las columnas `bytea` como texto hexadecimal
 * con el prefijo literal "\x" (formato estándar de salida de Postgres para
 * bytea), tanto al leer como al escribir vía la API REST. Estos dos helpers
 * evitan repetir esa conversión en cada lugar que toca una columna bytea.
 */
export function bufferAPgBytea(buf: Buffer): string {
  return `\\x${buf.toString('hex')}`;
}

export function pgByteaABuffer(valor: string): Buffer {
  const hex = valor.startsWith('\\x') ? valor.slice(2) : valor;
  return Buffer.from(hex, 'hex');
}
