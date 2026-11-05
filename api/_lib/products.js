export const PRODUCTS = {
  recetario: {
    id: 'recetario',
    name: 'Recetario Digital Sustento',
    // Estas descripciones se le mandan a MercadoPago y las ve el comprador en
    // el checkout, así que se escriben para esa persona, no para el catálogo.
    description: 'Más de 60 recetas con plantas para el día a día',
    ars: 40000,
    usd: 40,
    // Dónde vive el PDF dentro del store privado de Vercel Blob. Cada compra
    // genera un link firmado a este archivo que vence a las 24hs (ver
    // `entrega.js`). Si el archivo no está subido, la entrega se cae sola al
    // `driveUrl` de abajo.
    //
    // Esto tiene que coincidir con el nombre real del archivo en el store, no
    // con el que uno esperaría. El store manda ese mismo nombre en el
    // `content-disposition`, así que es el que ve el comprador al guardarlo.
    // Ojo al resubir desde una Mac: como esconde las extensiones, escribir el
    // `.pdf` al renombrar deja el archivo como `.pdf.pdf`.
    blobPathname: 'recetario-digital-sustento.pdf',
    // El link viejo de Drive. NO borrarlo: es la red de seguridad de la que
    // depende `entrega.js` cuando Blob no responde.
    driveUrl: 'https://drive.google.com/file/d/1i5kirECHgf4Cy-BMz5rhtIorT3pfwzuV/view?usp=sharing',
  },
  club: {
    id: 'club',
    name: 'Club Sustento — Suscripción mensual',
    description: 'Recetas nuevas todas las semanas y un seminario en vivo por mes',
    ars: 15000,
    usd: 10,
    recurring: true,
    // Plan de suscripción de MercadoPago (el link mpago.la/1U4znwx redirige
    // acá). webhook.js lo usa para saber de qué producto es cada cuota: hasta
    // el 05/11/2026 toda cuota recurrente se asumía del Club, y las de la Red
    // se habrían anunciado como Club.
    mpPlanId: '99ec2d10aa5b43ea8850df0cef6624a7',
    // Cómo se nombra el lugar al que Guido suma a mano a quien paga en pesos.
    espacio: 'el espacio del Club',
  },
  red: {
    id: 'red',
    name: 'Red Sustento — Suscripción mensual',
    description: 'Encuentros quincenales para profesionales de la salud',
    ars: 10000,
    usd: 10,
    recurring: true,
    mpPlanId: '100cbf378c084fcf83a7b31e60db334d',
    espacio: 'el grupo de la Red',
  },
};

/** Link al checkout de MercadoPago del plan de suscripción de un producto. */
export function checkoutDelPlan(product) {
  return `https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_plan_id=${product.mpPlanId}`;
}

/** El producto recurrente que corresponde a un plan de MercadoPago, o null. */
export function productoDelPlan(planId) {
  if (!planId) return null;
  return Object.values(PRODUCTS).find((p) => p.mpPlanId === planId) || null;
}
