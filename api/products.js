export const PRODUCTS = {
  recetario: {
    id: 'recetario',
    name: 'Recetario Digital Sustento',
    // Estas descripciones se le mandan a MercadoPago y las ve el comprador en
    // el checkout, así que se escriben para esa persona, no para el catálogo.
    description: 'Más de 60 recetas con plantas para el día a día',
    ars: 40000,
    usd: 40,
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
