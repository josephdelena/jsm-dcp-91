export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { image1h, user_api_key } = req.body;
  if (!image1h) return res.status(400).json({ error: 'Chart 1H wajib diupload' });

  const apiKey = user_api_key || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key tidak tersedia' });

  const systemPrompt = `Kamu adalah ekstractor konteks 1H untuk LP SOL/USDC.
Analisa chart 1H dan return JSON berikut:
{
  "trend": "BULLISH" / "SIDEWAYS" / "BEARISH",
  "range_low": 0.00,
  "range_high": 0.00,
  "bias": "UP" / "NEUTRAL" / "DOWN",
  "strength": "STRONG" / "MODERATE" / "WEAK",
  "support": 0.00,
  "resistance": 0.00,
  "note": "1 kalimat ringkasan"
}
Return HANYA JSON valid.`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 500,
        system: systemPrompt,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: image1h } },
            { type: 'text', text: 'Ekstrak konteks 1H dari chart ini.' }
          ]
        }]
      })
    });

    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data.error?.message });

    const text = data.content[0].text.trim().replace(/```json|```/g, '').trim();
    return res.status(200).json(JSON.parse(text));
  } catch (err) {
    return res.status(500).json({ error: 'Gagal ekstrak 1H: ' + err.message });
  }
}
