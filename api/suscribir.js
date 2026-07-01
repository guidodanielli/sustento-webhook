import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

async function agregarASupabase({ email, name, source, tags }) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

  const response = await fetch(`${SUPABASE_URL}/rest/v1/subscribers`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
      // Si el email ya existe, ignorar silenciosamente (no es un error).
      // return=representation nos deja saber si realmente se insertó una fila.
      'Prefer': 'resolution=ignore-duplicates,return=representation'
    },
    body: JSON.stringify({
      email,
      name: name || '',
      source: source || 'formulario-web',
      tags: tags || []
    })
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    console.error('Supabase subscribers error:', response.status, data);
    return { ok: false, isNew: false };
  }

  // Array con la fila insertada si es nuevo; array vacío si era duplicado ignorado.
  const rows = await response.json().catch(() => []);
  const isNew = Array.isArray(rows) && rows.length > 0;
  return { ok: true, isNew };
}

async function enviarBienvenida(email) {
  await resend.emails.send({
    from: `Guido Sustento <hola@haceloconsustento.com>`,
    to: email,
    subject: 'Bienvenido/a al ecosistema 🌿',
    html: `
      <div style="font-family: Georgia, serif; max-width: 600px; margin: 0 auto; color: #111; background: #f5eee0; padding: 0;">
        <div style="background: #1e6f1d; padding: 28px 40px;">
          <p style="color: #fff; font-family: Arial, sans-serif; font-size: 0.8rem; letter-spacing: 0.15em; text-transform: uppercase; margin: 0; opacity: 0.8;">Hacelo con Sustento</p>
        </div>
        <div style="padding: 48px 40px; background: #f5eee0;">
          <p style="font-size: 1rem; line-height: 1.8; color: #444; margin-bottom: 20px;">Hola,</p>
          <p style="font-size: 1rem; line-height: 1.8; color: #444; margin-bottom: 20px;">Gracias por sumarte. Que estés acá me dice que algo de lo que hago resonó con vos, y eso me alegra genuinamente.</p>
          <p style="font-size: 1rem; line-height: 1.8; color: #444; margin-bottom: 20px;">Por si no nos conocemos todavía: soy Guido, nutricionista y cocinero sustentable. Creo que la mejor forma de mejorar la salud no pasa por restringir sino por expandir — aprender a cocinar rico, comer con placer y entender qué le hace bien a tu cuerpo (y al planeta).</p>
          <p style="font-size: 1rem; line-height: 1.8; color: #444; margin-bottom: 20px;">Desde acá voy a mandarte recetas, novedades y recursos que uso yo mismo. Sin spam, sin fórmulas mágicas.</p>
          <p style="font-size: 1rem; line-height: 1.8; color: #444; margin-bottom: 20px;">La mayor parte de mi contenido del día a día vive en Instagram — si todavía no me seguís, te espero por ahí:<br>
            👉 <a href="https://www.instagram.com/guido.sustento/" style="color: #1e6f1d; font-weight: bold;">@guido.sustento</a></p>
          <p style="font-size: 1rem; line-height: 1.8; color: #444; margin-bottom: 36px;">Y si querés dar un primer paso concreto, tengo un <strong>Recetario Digital</strong> con +60 recetas plant-based simples y sabrosas. Por si te interesa explorarlo:<br>
            👉 <a href="https://www.haceloconsustento.com#recetario" style="color: #1e6f1d;">haceloconsustento.com</a></p>
          <p style="font-size: 1rem; line-height: 1.8; color: #444; margin-bottom: 4px;">Nos vemos,</p>
          <p style="font-size: 1rem; font-weight: bold; color: #1e6f1d; margin: 0;">Guido 🌱</p>
        </div>
        <div style="background: #111; padding: 20px 40px;">
          <p style="font-size: 0.75rem; color: rgba(255,255,255,0.3); margin: 0; text-align: center;">
            © 2026 Guido Sustento · <a href="https://www.haceloconsustento.com" style="color: rgba(255,255,255,0.4);">haceloconsustento.com</a>
          </p>
        </div>
      </div>
    `
  });
}

export default async function handler(req, res) {
  const allowedOrigins = ['https://haceloconsustento.com', 'https://www.haceloconsustento.com'];
const origin = req.headers.origin;
if (allowedOrigins.includes(origin)) {
  res.setHeader('Access-Control-Allow-Origin', origin);
};
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, name, source, tags } = req.body;
  if (!email) return res.status(400).json({ error: 'Email requerido' });

  try {
    const { ok, isNew } = await agregarASupabase({ email, name, source, tags });
    // Solo mandamos el welcome email a suscriptores nuevos (no a duplicados).
    if (ok && isNew) {
      await enviarBienvenida(email);
    }
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ error: 'Error interno' });
  }
}
