/**
 * Baja de la lista de mails.
 *
 * Dos entradas, misma acción:
 *  - GET  /api/baja?email=...  → la persona hizo clic en el link del pie del mail.
 *                                Devuelve una página de confirmación.
 *  - POST /api/baja?email=...  → Gmail y otros clientes que soportan el botón
 *                                nativo de "Cancelar suscripción" (header
 *                                List-Unsubscribe-Post). Devuelve JSON.
 *
 * No borra la fila: le marca el tag "baja". Así queda el registro de quién se
 * fue y cuándo se sumó, y no se pierde el histórico. Cualquier envío masivo
 * futuro tiene que filtrar por este tag.
 */

const BAJA_TAG = 'baja';

async function marcarBaja(email) {
  const url = `${process.env.SUPABASE_URL}/rest/v1/subscribers?email=eq.${encodeURIComponent(email)}`;

  const response = await fetch(url, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'apikey': process.env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify({ tags: [BAJA_TAG] })
  });

  if (!response.ok) {
    const detalle = await response.text().catch(() => '');
    console.error('Supabase baja error:', response.status, detalle);
    return false;
  }
  return true;
}

function paginaConfirmacion({ ok, email }) {
  const titulo = ok ? 'Listo, te dimos de baja' : 'No pudimos procesar la baja';
  const cuerpo = ok
    ? `No vas a recibir más mails míos en <strong>${email}</strong>. Si fue sin querer, escribime y te vuelvo a sumar.`
    : 'Algo falló de nuestro lado. Escribime a guidosustento.nutri@gmail.com y lo resuelvo a mano.';

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>${titulo} · Hacelo con Sustento</title>
</head>
<body style="margin:0; background:#f5eee0; font-family:Georgia, serif; color:#111;">
  <div style="max-width:520px; margin:0 auto; padding:80px 24px;">
    <p style="font-family:Arial, sans-serif; font-size:0.75rem; letter-spacing:0.15em; text-transform:uppercase; color:#1e6f1d; margin:0 0 24px 0;">Hacelo con Sustento</p>
    <h1 style="font-size:1.6rem; color:#1e6f1d; margin:0 0 16px 0;">${titulo}</h1>
    <p style="font-size:1rem; line-height:1.8; color:#444; margin:0 0 32px 0;">${cuerpo}</p>
    <a href="https://www.haceloconsustento.com" style="color:#1e6f1d; font-size:0.95rem;">Volver a haceloconsustento.com</a>
  </div>
</body>
</html>`;
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const email = req.query?.email;

  if (!email) {
    if (req.method === 'POST') return res.status(400).json({ error: 'Email requerido' });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(400).send(paginaConfirmacion({ ok: false, email: '' }));
  }

  const ok = await marcarBaja(email);

  // El botón nativo del cliente de mail no muestra nada: solo espera un 200.
  if (req.method === 'POST') {
    return res.status(ok ? 200 : 500).json({ success: ok });
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(ok ? 200 : 500).send(paginaConfirmacion({ ok, email }));
}
