export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://www.haceloconsustento.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email requerido' });

  const API_KEY = process.env.MAILCHIMP_API_KEY;
  const AUDIENCE_ID = '95366c372a';
  // El datacenter está en la última parte de la API key (ej: us21)
  const DC = API_KEY.split('-').pop();

  try {
    const response = await fetch(
      `https://${DC}.api.mailchimp.com/3.0/lists/${AUDIENCE_ID}/members`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${Buffer.from(`anystring:${API_KEY}`).toString('base64')}`
        },
        body: JSON.stringify({
          email_address: email,
          status: 'subscribed',
          tags: ['landing-web']
        })
      }
    );

    const data = await response.json();

    // Si ya estaba suscripto, lo tratamos como éxito igual
    if (response.ok || data.title === 'Member Exists') {
      return res.status(200).json({ success: true });
    }

    console.error('Mailchimp error:', data);
    return res.status(500).json({ error: 'No se pudo suscribir' });

  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ error: 'Error interno' });
  }
}
