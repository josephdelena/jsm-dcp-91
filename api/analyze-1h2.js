export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { imageBase64, mediaType } = req.body;
  if (!imageBase64) return res.status(400).json({ error: 'No image provided' });

  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  const safeMediaType = allowedTypes.includes(mediaType) ? mediaType : 'image/png';
  const cleanBase64 = imageBase64.replace(/^data:image\/[a-z]+;base64,/, '');

  const systemPrompt = `Kamu adalah JSM DCP 08 AGENT. Tugasmu sekarang adalah mengekstrak struktur market dari chart 1H SOL/USDC.

Ekstrak informasi berikut secara objektif dan presisi:
1. TREND: Bullish / Bearish / Sideways
2. RANGE: harga low - harga high (20 candle terakhir)
3. RANGE_LOW: angka batas bawah range (contoh: 138.50)
4. RANGE_HIGH: angka batas atas range (contoh: 145.20)
5. SUPPORT: level support terkuat + jumlah test
6. RESISTANCE: level resistance terkuat + jumlah test
7. MAGNET: liquidity magnet (level besar yang belum disentuh)
8. BIAS: UP / DOWN / NEUTRAL + strength (WEAK/MODERATE/STRONG)
9. STRUKTUR: 1-2 kalimat objektif tentang kondisi 1H
10. CURRENT_PRICE: estimasi harga terakhir yang terlihat di chart

Balas HANYA dengan JSON berikut tanpa teks lain:
{
  "trend": "SIDEWAYS",
  "rangeLow": 138.50,
  "rangeHigh": 145.20,
  "rangeMid": 141.85,
  "support": "138.50 (3x tested)",
  "resistance": "144.80 (2x tested)",
  "magnet": "141.20",
  "bias": "NEUTRAL",
  "biasStrength": "MODERATE",
  "struktur": "Konsolidasi dalam range ketat. Belum ada tanda breakdown.",
  "currentPrice": 141.50,
  "valid": true
}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 600,
        system: systemPrompt,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: safeMediaType, data: cleanBase64 } },
            { type: 'text', text: 'Ekstrak struktur 1H dari chart ini. Balas JSON saja.' }
          ]
        }]
      }),
    });

    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data?.error?.message || 'API Error' });

    const raw = data.content?.map(i => i.text || '').join('') || '';
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return res.status(500).json({ error: 'JSON tidak ditemukan' });

    const parsed = JSON.parse(match[0]);
    parsed.updatedAt = new Date().toISOString();
    return res.status(200).json(parsed);

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
