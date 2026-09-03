import { issueSignedToken, presignUrl } from '@vercel/blob';

/**
 * Arma el link de descarga de un producto digital.
 *
 * POR QUÉ EXISTE: hasta ahora el Recetario se entregaba con un link de Google
 * Drive permanente. Quien lo compraba podía reenviarlo y el que lo recibía
 * tenía el PDF completo sin pagar. Con Vercel Blob el archivo vive en un store
 * privado y cada compra genera su propio link firmado, que muere a las 24hs.
 *
 * LA REGLA DE ORO DE ESTE ARCHIVO: si algo del lado de Blob falla, se cae al
 * link de Drive de siempre. Una venta que se cobró tiene que entregar el
 * producto, aunque sea con el link viejo. Nunca dejar a alguien que pagó sin
 * su archivo por un problema de infraestructura.
 *
 * Eso también hace que se pueda deployar antes de que el store exista: sin
 * `blobPathname` en el producto, o sin store configurado, todo sigue como
 * hasta ahora.
 */

const HORAS_DE_VIDA = 24;

/**
 * Confirma que el archivo esté realmente en el store antes de prometerlo.
 *
 * Sin esto, un store creado pero con el PDF todavía sin subir produciría un
 * link firmado impecable que da 404 del otro lado. Es peor que el link viejo:
 * el comprador no recibe nada y nosotros creemos que sí. Se firma un pedido
 * `head`, que trae los headers del archivo sin bajar los bytes.
 */
async function existeEnElStore(pathname) {
  const token = await issueSignedToken({
    pathname,
    operations: ['head'],
    validUntil: Date.now() + 60 * 1000
  });

  const { presignedUrl } = await presignUrl(token, {
    operation: 'head',
    pathname,
    access: 'private'
  });

  const respuesta = await fetch(presignedUrl, { method: 'HEAD' });
  return respuesta.ok;
}

/**
 * Devuelve `{ url, expira }` para el producto.
 *
 * `expira` le avisa al mail si tiene que aclarar que el link vence, porque el
 * texto cambia según de dónde salió el link.
 */
export async function linkDeDescarga(product) {
  const linkViejo = { url: product.driveUrl, expira: false };

  if (!product?.blobPathname) return linkViejo;

  try {
    if (!(await existeEnElStore(product.blobPathname))) {
      console.error(
        `Blob: "${product.blobPathname}" no está en el store todavía. Se entrega con el link de Drive.`
      );
      return linkViejo;
    }

    const validUntil = Date.now() + HORAS_DE_VIDA * 60 * 60 * 1000;

    const token = await issueSignedToken({
      pathname: product.blobPathname,
      operations: ['get'],
      validUntil
    });

    const { presignedUrl } = await presignUrl(token, {
      operation: 'get',
      pathname: product.blobPathname,
      access: 'private',
      validUntil
    });

    return { url: presignedUrl, expira: true };

  } catch (error) {
    // El log queda en Vercel con el error entero: es la única forma de
    // enterarse de que las entregas volvieron al link viejo sin que nadie se
    // haya quedado sin su compra mientras tanto.
    console.error('Blob: no se pudo firmar el link, se entrega con el de Drive.', error);
    return linkViejo;
  }
}

export { HORAS_DE_VIDA };
