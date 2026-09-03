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
    // ⚠️ EL `.pdf.pdf` NO ES UN ERROR DE TIPEO: es el nombre real con el que
    // el archivo quedó subido el 03/09/2026. Pasó porque macOS esconde las
    // extensiones y al renombrarlo se le sumó una segunda. Tiene una
    // consecuencia visible: el `content-disposition` que manda el store dice
    // ese nombre, así que es el que ve el comprador al guardarlo. Para
    // limpiarlo hay que borrar el blob, volver a subirlo con el nombre bueno
    // y cambiar esta línea. Mientras tanto, esto tiene que coincidir con lo
    // que hay en el store, no con lo que nos gustaría que hubiera.
    blobPathname: 'recetario-digital-sustento.pdf.pdf',
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
  },
};
