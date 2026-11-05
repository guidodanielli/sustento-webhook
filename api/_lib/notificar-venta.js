import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

// A dónde llegan los avisos de venta. Es la casilla que Guido lee todos los días.
const AVISO_A = 'guidosustento.nutri@gmail.com';

// En la bandeja, el nombre del remitente pesa más que el asunto: es lo primero
// y lo más grande que se lee. Por eso cada tipo de aviso usa el suyo. Cuando los
// tres salían como "Ventas Sustento", un alta a la lista se leía como si hubiera
// entrado plata, y no entró nada: la persona solo dejó el mail.
function remitente(nombre) {
  return `${nombre} <${process.env.RESEND_FROM_EMAIL}>`;
}

function formatearMonto(amount, currency) {
  const numero = new Intl.NumberFormat('es-AR').format(amount);
  return currency === 'USD' ? `USD ${numero}` : `$${numero} ARS`;
}

function fechaArgentina() {
  return new Date().toLocaleString('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function fila(label, valor) {
  return `
    <tr>
      <td style="padding: 10px 0; border-bottom: 1px solid #e3d9c6; font-family: Arial, sans-serif; font-size: 0.85rem; color: #888; width: 40%;">${label}</td>
      <td style="padding: 10px 0; border-bottom: 1px solid #e3d9c6; font-family: Arial, sans-serif; font-size: 0.95rem; color: #111; font-weight: 600;">${valor}</td>
    </tr>
  `;
}

// Lo que escribió la persona en un formulario se escapa antes de entrar al HTML.
function esc(texto) {
  return String(texto ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// wa.me pide el número con código de país y solo dígitos.
export function linkDeWhatsapp(numero) {
  return `https://wa.me/${String(numero).replace(/\D/g, '')}`;
}

// Version en texto plano de una tabla de datos. Todos los mails llevan las dos
// versiones: uno que va solo en HTML le parece envio masivo a Gmail.
function bloqueTexto(pares) {
  return pares.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join('\n');
}

/**
 * Avisa a Guido por mail que entró una venta.
 *
 * Nunca tira error hacia afuera: si el aviso falla, la entrega del producto al
 * comprador tiene que seguir su curso igual. Solo queda el log en Vercel.
 *
 * `entregaFallida` es para cuando el mail al comprador no salió. La compra ya
 * quedó registrada, así que la pasarela no va a volver a avisar: si este aviso
 * no lo dice, nadie se entera de que la persona pagó y no recibió nada.
 */
export async function notificarVenta({ product, buyerEmail, buyerName, amount, currency, paymentMethod, paymentId, recurrente = false, accesoAutomatico = false, renovacion = false, entregaFallida = false, linkEntrega = null, contacto = null }) {
  try {
    const monto = formatearMonto(amount, currency);
    const esDescargable = Boolean(product.driveUrl);
    const espacio = product.espacio || 'el espacio del Club';
    // El WhatsApp que dejó en /suscribirme/, si se encontró por el mail.
    const whatsapp = contacto?.whatsapp || null;
    const linkWhatsapp = whatsapp ? linkDeWhatsapp(whatsapp) : null;

    // Lo que Guido tiene que hacer (o no) según el tipo de producto.
    let queHacer;
    if (entregaFallida) {
      queHacer = `<p style="font-size: 0.95rem; line-height: 1.7; color: #7a3b12; margin: 0 0 12px 0;">
           <strong>⚠️ El mail al comprador NO salió.</strong> Pagó y no recibió nada.
         </p>
         <p style="font-size: 0.95rem; line-height: 1.7; color: #444; margin: 0;">
           Respondé este mail (le llega directo) y mandale ${esDescargable ? `el link de descarga: <a href="${linkEntrega}">${linkEntrega}</a>` : `la bienvenida y el acceso a ${espacio}`}.
         </p>`;
    } else if (esDescargable) {
      queHacer = `<p style="font-size: 0.95rem; line-height: 1.7; color: #444; margin: 0;">
           El link de descarga ya le salió por mail automáticamente. No tenés que hacer nada.
         </p>`;
    } else if (accesoAutomatico) {
      // Whop: da el acceso a la comunidad por su cuenta.
      queHacer = `<p style="font-size: 0.95rem; line-height: 1.7; color: #444; margin: 0;">
           ${renovacion ? 'Es la renovación mensual de un miembro que ya está adentro.' : 'Whop ya le mandó la invitación a la comunidad.'} No tenés que hacer nada.
         </p>`;
    } else if (recurrente) {
      // Suscripción de MercadoPago: cobra sola, pero el acceso lo das vos.
      queHacer = `<p style="font-size: 0.95rem; line-height: 1.7; color: #444; margin: 0 0 12px 0;">
           <strong>${renovacion ? 'Es una renovación: revisá que ya tenga acceso.' : 'Te toca una sola cosa:'}</strong>
         </p>
         <p style="font-size: 0.95rem; line-height: 1.7; color: #444; margin: 0;">
           Sumarlo a ${espacio} a mano${whatsapp ? `: te dejó su WhatsApp, <a href="${linkWhatsapp}">${esc(whatsapp)}</a>` : '. No se encontró el formulario de la web con este mail: respondé este mail para pedirle el WhatsApp'}. La suscripción por ${paymentMethod} sí se renueva sola todos los meses, pero no manda ninguna invitación.
         </p>`;
    } else {
      queHacer = `<p style="font-size: 0.95rem; line-height: 1.7; color: #444; margin: 0 0 12px 0;">
           <strong>Te toca hacer dos cosas:</strong>
         </p>
         <p style="font-size: 0.95rem; line-height: 1.7; color: #444; margin: 0 0 8px 0;">
           1. Darle el acceso al espacio del Club a mano. El mail que recibió le dice que le vas a escribir en las próximas horas.
         </p>
         <p style="font-size: 0.95rem; line-height: 1.7; color: #444; margin: 0;">
           2. Anotar que este cobro por ${paymentMethod} es de un mes solo. No se renueva solo: el cobro recurrente lo hace Whop.
         </p>`;
    }

    await resend.emails.send({
      from: remitente('Ventas Sustento'),
      reply_to: buyerEmail,
      to: AVISO_A,
      subject: entregaFallida
        ? `⚠️ Venta sin entregar: ${product.name} · ${monto}`
        : `${renovacion ? 'Renovación' : 'Venta'}: ${product.name} · ${monto} 🌱`,
      text: [
        entregaFallida
          ? `ATENCIÓN: el mail al comprador NO salió. Pagó y no recibió nada. Respondé este mail y mandale ${esDescargable ? `el link de descarga: ${linkEntrega}` : `la bienvenida y el acceso a ${espacio}`}.`
          : null,
        renovacion ? 'Se renovó una suscripción.' : 'Entró una venta.',
        bloqueTexto([
          ['Producto', product.name],
          ['Monto', monto],
          ['Comprador', buyerName ? `${buyerName} (${buyerEmail})` : buyerEmail],
          ['WhatsApp', whatsapp ? `${whatsapp} (${linkWhatsapp})` : null],
          ['Medio de pago', paymentMethod],
          ['Fecha', fechaArgentina()],
          ['ID de pago', paymentId]
        ]),
        entregaFallida
          ? null
          : esDescargable
            ? 'El link de descarga ya le salió por mail. No tenés que hacer nada.'
            : (accesoAutomatico
                ? 'Whop ya le dio el acceso. No tenés que hacer nada.'
                : `Te toca sumarlo a ${espacio} a mano.`),
        'Si respondés este mail, le escribís directo al comprador.'
      ].filter(Boolean).join('\n\n'),
      html: `
        <div style="font-family: Georgia, serif; max-width: 600px; margin: 0 auto; color: #111;">
          <div style="background: #1e6f1d; padding: 24px 32px;">
            <p style="color: #fff; font-family: Arial, sans-serif; font-size: 0.8rem; letter-spacing: 0.15em; text-transform: uppercase; margin: 0; opacity: 0.8;">${renovacion ? 'Se renovó una suscripción' : 'Entró una venta'}</p>
          </div>
          <div style="padding: 32px; background: #f5eee0;">
            <p style="font-size: 1.35rem; font-family: Georgia, serif; color: #1e6f1d; margin: 0 0 24px 0;">
              ${monto} · ${product.name}
            </p>
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 28px;">
              ${fila('Comprador', buyerName ? `${buyerName} (${buyerEmail})` : buyerEmail)}
              ${whatsapp ? fila('WhatsApp', `<a href="${linkWhatsapp}" style="color: #1e6f1d;">${esc(whatsapp)}</a>`) : ''}
              ${fila('Medio de pago', paymentMethod)}
              ${fila('Fecha', fechaArgentina())}
              ${fila('ID de pago', paymentId)}
            </table>
            <div style="background: #fff; border-left: 3px solid #1e6f1d; padding: 16px 20px;">
              ${queHacer}
            </div>
            <p style="font-size: 0.85rem; color: #888; margin: 24px 0 0 0; font-family: Arial, sans-serif;">
              Si respondés este mail, le escribís directo al comprador.
            </p>
          </div>
        </div>
      `
    });
  } catch (err) {
    console.error('Error al notificar la venta:', err);
  }
}

/**
 * Avisa a Guido que entró un cobro por MercadoPago que no salió de la web.
 *
 * El webhook recibe TODOS los cobros de la cuenta, no solo los del checkout:
 * un link de pago o un cobro del Método también llegan acá. Hasta el 23/10/2026
 * esos caían en "recetario" por defecto, y el que pagaba recibía un Recetario
 * que no compró. Ahora no se le manda nada a la persona y Guido decide.
 *
 * Igual que notificarVenta, nunca tira error hacia afuera.
 */
export async function notificarCobroSinProducto({ buyerEmail, buyerName, amount, currency, descripcion, paymentId }) {
  try {
    const monto = formatearMonto(amount, currency);
    const comprador = buyerName ? `${buyerName} (${buyerEmail})` : buyerEmail;

    await resend.emails.send({
      // Entró plata, así que va con el remitente de ventas.
      from: remitente('Ventas Sustento'),
      reply_to: buyerEmail || undefined,
      to: AVISO_A,
      subject: `Cobro por MercadoPago: ${monto} · ${buyerName || buyerEmail}`,
      text: [
        'Entró un cobro por MercadoPago que no salió del checkout de la web.',
        bloqueTexto([
          ['Monto', monto],
          ['Pagó', comprador],
          ['Concepto', descripcion || 'sin descripción'],
          ['Fecha', fechaArgentina()],
          ['ID de pago', paymentId]
        ]),
        'No se le mandó nada a la persona. Si era un producto de la web, mandáselo vos respondiendo este mail.'
      ].join('\n\n'),
      html: `
        <div style="font-family: Georgia, serif; max-width: 600px; margin: 0 auto; color: #111;">
          <div style="background: #1e6f1d; padding: 24px 32px;">
            <p style="color: #fff; font-family: Arial, sans-serif; font-size: 0.8rem; letter-spacing: 0.15em; text-transform: uppercase; margin: 0; opacity: 0.8;">Entró un cobro por MercadoPago</p>
          </div>
          <div style="padding: 32px; background: #f5eee0;">
            <p style="font-size: 1.35rem; font-family: Georgia, serif; color: #1e6f1d; margin: 0 0 24px 0;">
              ${monto}
            </p>
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 28px;">
              ${fila('Pagó', comprador)}
              ${fila('Concepto', descripcion || 'sin descripción')}
              ${fila('Fecha', fechaArgentina())}
              ${fila('ID de pago', paymentId)}
            </table>
            <div style="background: #fff; border-left: 3px solid #1e6f1d; padding: 16px 20px;">
              <p style="font-size: 0.95rem; line-height: 1.7; color: #444; margin: 0;">
                No salió del checkout de la web, así que no se le mandó nada a la persona. Si era un producto de la web, mandáselo vos respondiendo este mail.
              </p>
            </div>
          </div>
        </div>
      `
    });
  } catch (err) {
    console.error('Error al notificar el cobro sin producto:', err);
  }
}

/**
 * Avisa a Guido que alguien se dio de baja del Club.
 *
 * Hasta el 07/08/2026 una cancelación no llegaba a ningún lado: Whop la
 * procesaba en silencio. Igual que notificarVenta, nunca tira error hacia
 * afuera — un aviso fallido no puede romper el webhook.
 */
export async function notificarBaja({ buyerEmail, buyerName, motivo, plataforma = 'Whop', product = null }) {
  // Hasta el 05/11/2026 solo el Club tenía bajas que avisar; ahora también la Red.
  const deQue = product?.id === 'red' ? 'de la Red' : 'del Club';
  try {
    await resend.emails.send({
      from: remitente('Avisos Sustento'),
      reply_to: buyerEmail || undefined,
      to: AVISO_A,
      subject: `Baja ${deQue}: ${buyerName || buyerEmail || 'un miembro'}`,
      text: [
        `Alguien se dio de baja ${deQue}.`,
        bloqueTexto([
          ['Miembro', buyerName ? `${buyerName} (${buyerEmail || 'sin mail'})` : (buyerEmail || 'sin datos')],
          ['Plataforma', plataforma],
          ['Motivo', motivo || 'no informado'],
          ['Fecha', fechaArgentina()]
        ]),
        plataforma === 'Whop'
          ? 'Whop ya le sacó el acceso. Este mail responde directo a su casilla.'
          : `Revisá si todavía está en ${product?.espacio || 'el espacio del Club'} y sacalo a mano.`
      ].join('\n\n'),
      html: `
        <div style="font-family: Georgia, serif; max-width: 600px; margin: 0 auto; color: #111;">
          <div style="background: #7a3b12; padding: 24px 32px;">
            <p style="color: #fff; font-family: Arial, sans-serif; font-size: 0.8rem; letter-spacing: 0.15em; text-transform: uppercase; margin: 0; opacity: 0.8;">Se dio de baja ${deQue}</p>
          </div>
          <div style="padding: 32px; background: #f5eee0;">
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 28px;">
              ${fila('Miembro', buyerName ? `${buyerName} (${buyerEmail || 'sin mail'})` : (buyerEmail || 'sin datos'))}
              ${fila('Plataforma', plataforma)}
              ${fila('Motivo', motivo || 'no informado')}
              ${fila('Fecha', fechaArgentina())}
            </table>
            <div style="background: #fff; border-left: 3px solid #7a3b12; padding: 16px 20px;">
              <p style="font-size: 0.95rem; line-height: 1.7; color: #444; margin: 0;">
                ${plataforma === 'Whop'
                  ? 'Whop ya le sacó el acceso a la comunidad. Si querés entender por qué se fue, este mail responde directo a su casilla.'
                  : `Revisá si todavía está en ${product?.espacio || 'el espacio del Club'} y sacalo a mano.`}
              </p>
            </div>
          </div>
        </div>
      `
    });
  } catch (err) {
    console.error('Error al notificar la baja:', err);
  }
}

// Como se lee cada source en el aviso. El quiz manda quiz-*; el formulario del
// pie manda formulario-web. Un source desconocido se muestra tal cual vino.
const ETIQUETA_SOURCE = {
  'quiz-club': 'Quiz · Club',
  'quiz-metodo': 'Quiz · Método',
  'quiz-recetario': 'Quiz · Recetario',
  'quiz-red': 'Quiz · Red',
  'formulario-web': 'Formulario del pie',
  'regalo': 'Regalo · seguidores nuevos'
};

/**
 * Avisa a Guido que alguien nuevo dejó el mail.
 *
 * Hasta el 24/08/2026 un alta no llegaba a ningún lado: entraba a Supabase en
 * silencio y la única forma de enterarse era abrir la tabla a mano. El silencio
 * se leía como que no había gente, y sí había.
 *
 * Solo se llama con altas reales (isNew), nunca con duplicados ignorados.
 * Igual que notificarVenta, nunca tira error hacia afuera: si el aviso falla,
 * la persona igual quedó suscripta y su mail de bienvenida ya salió.
 */
export async function notificarSuscriptor({ email, name, source, motivo = '', origen = '', barrera = '', total = null }) {
  try {
    const etiqueta = ETIQUETA_SOURCE[source] || source || 'sin origen';

    await resend.emails.send({
      from: remitente('Lista Sustento'),
      // Responder al aviso escribe directo a la persona que se suscribió.
      reply_to: email || undefined,
      to: AVISO_A,
      // "Alta" solo también se leía como un alta al Club. Nombrar la lista saca
      // la duda de si entró plata: no entró, la persona dejó el mail y nada más.
      subject: `Nuevo en la lista: ${etiqueta} 🌱`,
      text: [
        'Alguien nuevo dejó el mail.',
        bloqueTexto([
          ['Persona', name ? `${name} (${email})` : email],
          ['Por dónde entró', etiqueta],
          ['De dónde vino', origen],
          ['Qué le cuesta', barrera],
          ['Fecha', fechaArgentina()],
          ['Total en la lista', total ? `${total} suscriptores` : '']
        ]),
        motivo ? `Qué la trajo, en sus palabras:\n"${motivo}"` : '',
        `El mail de bienvenida de ${etiqueta} ya le salió. No tenés que hacer nada. Si respondés este mail, le escribís directo.`
      ].filter(Boolean).join('\n\n'),
      html: `
        <div style="font-family: Georgia, serif; max-width: 600px; margin: 0 auto; color: #111;">
          <div style="background: #2d6a5a; padding: 24px 32px;">
            <p style="color: #fff; font-family: Arial, sans-serif; font-size: 0.8rem; letter-spacing: 0.15em; text-transform: uppercase; margin: 0; opacity: 0.8;">Alguien nuevo dejó el mail</p>
          </div>
          <div style="padding: 32px; background: #f5eee0;">
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 28px;">
              ${fila('Persona', name ? `${name} (${email})` : email)}
              ${fila('Por dónde entró', etiqueta)}
              ${origen ? fila('De dónde vino', origen) : ''}
              ${barrera ? fila('Qué le cuesta', barrera) : ''}
              ${fila('Fecha', fechaArgentina())}
              ${total ? fila('Total en la lista', `${total} suscriptores`) : ''}
            </table>
            ${motivo ? `
            <div style="background: #fff; border-left: 3px solid #7a3b12; padding: 16px 20px; margin: 0 0 16px 0;">
              <p style="font-family: Arial, sans-serif; font-size: 0.75rem; letter-spacing: 0.1em; text-transform: uppercase; color: #888; margin: 0 0 8px 0;">Qué la trajo, en sus palabras</p>
              <p style="font-size: 1rem; line-height: 1.7; color: #111; margin: 0; font-style: italic;">“${motivo}”</p>
            </div>` : ''}
            <div style="background: #fff; border-left: 3px solid #2d6a5a; padding: 16px 20px;">
              <p style="font-size: 0.95rem; line-height: 1.7; color: #444; margin: 0;">
                El mail de bienvenida que le corresponde a <strong>${etiqueta}</strong> ya le salió automáticamente. No tenés que hacer nada. Si querés escribirle, respondé este mail y le llega directo.
              </p>
            </div>
          </div>
        </div>
      `
    });
  } catch (err) {
    console.error('Error al notificar el alta:', err);
  }
}

/**
 * Avisa a Guido que alguien completó /suscribirme/ y se fue a pagar.
 *
 * Todavía NO hay plata: el remitente es "Avisos Sustento" y el asunto dice
 * "Por pagar" para que no se lea como venta. Existe porque el pago puede
 * entrar con una cuenta de MercadoPago de otro mail, y en ese caso el aviso de
 * venta no encuentra el WhatsApp: este mail lo deja en la bandeja igual.
 *
 * Igual que los otros avisos, nunca tira error hacia afuera.
 */
export async function notificarPorPagar({ product, nombre, email, whatsapp, origen = '' }) {
  try {
    const link = linkDeWhatsapp(whatsapp);
    const espacio = product.espacio || 'el espacio del Club';
    const corto = product.id === 'red' ? 'Red' : 'Club';
    await resend.emails.send({
      from: remitente('Avisos Sustento'),
      reply_to: email,
      to: AVISO_A,
      subject: `Por pagar: ${corto} · ${nombre}`,
      text: [
        `${nombre} completó el formulario de la web y se fue a pagar ${corto === 'Red' ? 'la Red' : 'el Club'} en Mercado Pago. Todavía no está confirmado el pago.`,
        bloqueTexto([
          ['Nombre', nombre],
          ['Mail', email],
          ['WhatsApp', `${whatsapp} (${link})`],
          ['Llegó desde', origen],
          ['Fecha', fechaArgentina()]
        ]),
        `Cuando entre el pago te llega el aviso de venta (o el mail de Mercado Pago). Ahí lo sumás a ${espacio}.`
      ].join('\n\n'),
      html: `
        <div style="font-family: Georgia, serif; max-width: 600px; margin: 0 auto; color: #111;">
          <div style="background: #7c4a1e; padding: 24px 32px;">
            <p style="color: #fff; font-family: Arial, sans-serif; font-size: 0.8rem; letter-spacing: 0.15em; text-transform: uppercase; margin: 0; opacity: 0.85;">Por pagar · todavía sin cobro</p>
          </div>
          <div style="padding: 32px; background: #f5eee0;">
            <p style="font-size: 1.25rem; font-family: Georgia, serif; color: #1e6f1d; margin: 0 0 24px 0;">
              ${esc(nombre)} se fue a pagar ${corto === 'Red' ? 'la Red' : 'el Club'}
            </p>
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 28px;">
              ${fila('Mail', esc(email))}
              ${fila('WhatsApp', `<a href="${link}" style="color: #1e6f1d;">${esc(whatsapp)}</a>`)}
              ${origen ? fila('Llegó desde', esc(origen)) : ''}
              ${fila('Fecha', fechaArgentina())}
            </table>
            <div style="background: #fff; border-left: 3px solid #7c4a1e; padding: 16px 20px;">
              <p style="font-size: 0.95rem; line-height: 1.7; color: #444; margin: 0;">
                Todavía no está confirmado el pago. Cuando entre, te llega el aviso de venta (o el mail de Mercado Pago) y ahí lo sumás a ${espacio}.
              </p>
            </div>
          </div>
        </div>
      `
    });
  } catch (err) {
    console.error('Error al avisar el alta por pagar:', err);
  }
}
