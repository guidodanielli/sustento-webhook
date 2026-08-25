import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

// A dónde llegan los avisos de venta. Es la casilla que Guido lee todos los días.
const AVISO_A = 'guidosustento.nutri@gmail.com';

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
 */
export async function notificarVenta({ product, buyerEmail, buyerName, amount, currency, paymentMethod, paymentId, recurrente = false, accesoAutomatico = false, renovacion = false }) {
  try {
    const monto = formatearMonto(amount, currency);
    const esDescargable = Boolean(product.driveUrl);

    // Lo que Guido tiene que hacer (o no) según el tipo de producto.
    let queHacer;
    if (esDescargable) {
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
           Darle el acceso al espacio del Club a mano. La suscripción por ${paymentMethod} sí se renueva sola todos los meses, pero no manda ninguna invitación.
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
      from: `Ventas Sustento <${process.env.RESEND_FROM_EMAIL}>`,
      reply_to: buyerEmail,
      to: AVISO_A,
      subject: `${renovacion ? 'Renovación' : 'Venta'}: ${product.name} · ${monto} 🌱`,
      text: [
        renovacion ? 'Se renovó una suscripción.' : 'Entró una venta.',
        bloqueTexto([
          ['Producto', product.name],
          ['Monto', monto],
          ['Comprador', buyerName ? `${buyerName} (${buyerEmail})` : buyerEmail],
          ['Medio de pago', paymentMethod],
          ['Fecha', fechaArgentina()],
          ['ID de pago', paymentId]
        ]),
        esDescargable
          ? 'El link de descarga ya le salió por mail. No tenés que hacer nada.'
          : (accesoAutomatico
              ? 'Whop ya le dio el acceso. No tenés que hacer nada.'
              : 'Te toca darle el acceso al espacio del Club a mano.'),
        'Si respondés este mail, le escribís directo al comprador.'
      ].join('\n\n'),
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
 * Avisa a Guido que alguien se dio de baja del Club.
 *
 * Hasta el 07/08/2026 una cancelación no llegaba a ningún lado: Whop la
 * procesaba en silencio. Igual que notificarVenta, nunca tira error hacia
 * afuera — un aviso fallido no puede romper el webhook.
 */
export async function notificarBaja({ buyerEmail, buyerName, motivo, plataforma = 'Whop' }) {
  try {
    await resend.emails.send({
      from: `Ventas Sustento <${process.env.RESEND_FROM_EMAIL}>`,
      reply_to: buyerEmail || undefined,
      to: AVISO_A,
      subject: `Baja del Club: ${buyerName || buyerEmail || 'un miembro'}`,
      text: [
        'Alguien se dio de baja del Club.',
        bloqueTexto([
          ['Miembro', buyerName ? `${buyerName} (${buyerEmail || 'sin mail'})` : (buyerEmail || 'sin datos')],
          ['Plataforma', plataforma],
          ['Motivo', motivo || 'no informado'],
          ['Fecha', fechaArgentina()]
        ]),
        plataforma === 'Whop'
          ? 'Whop ya le sacó el acceso. Este mail responde directo a su casilla.'
          : 'Revisá si todavía tiene acceso al espacio del Club y sacáselo a mano.'
      ].join('\n\n'),
      html: `
        <div style="font-family: Georgia, serif; max-width: 600px; margin: 0 auto; color: #111;">
          <div style="background: #7a3b12; padding: 24px 32px;">
            <p style="color: #fff; font-family: Arial, sans-serif; font-size: 0.8rem; letter-spacing: 0.15em; text-transform: uppercase; margin: 0; opacity: 0.8;">Se dio de baja del Club</p>
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
                  : 'Revisá si todavía tiene acceso al espacio del Club y sacáselo a mano.'}
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
  'formulario-web': 'Formulario del pie'
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
export async function notificarSuscriptor({ email, name, source, motivo = '', origen = '', total = null }) {
  try {
    const etiqueta = ETIQUETA_SOURCE[source] || source || 'sin origen';

    await resend.emails.send({
      from: `Ventas Sustento <${process.env.RESEND_FROM_EMAIL}>`,
      // Responder al aviso escribe directo a la persona que se suscribió.
      reply_to: email || undefined,
      to: AVISO_A,
      subject: `Alta nueva: ${etiqueta} 🌱`,
      text: [
        'Alguien nuevo dejó el mail.',
        bloqueTexto([
          ['Persona', name ? `${name} (${email})` : email],
          ['Por dónde entró', etiqueta],
          ['De dónde vino', origen],
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
