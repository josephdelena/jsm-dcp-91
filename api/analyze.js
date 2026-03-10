const SUPABASE_URL = `https://${process.env.SUPABASE_PROJECT_ID}.supabase.co`;
const SUPABASE_SECRET = process.env.SUPABASE_SECRET_KEY;

async function logUsage(user_id, tokens_used) {
  const cost_usd = (tokens_used / 1000000) * 3.0; // Sonnet pricing ~$3/1M tokens
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/usage_logs`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_SECRET,
        'Authorization': `Bearer ${SUPABASE_SECRET}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ user_id, agent: 'jsm-dcp-91', tokens_used, cost_usd })
    });
  } catch (e) { /* non-blocking */ }
}

async function checkUser(user_id) {
  if (!user_id) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/users?id=eq.${user_id}&select=id,name,status`, {
      headers: {
        'apikey': SUPABASE_SECRET,
        'Authorization': `Bearer ${SUPABASE_SECRET}`
      }
    });
    const data = await res.json();
    return data[0] || null;
  } catch { return null; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { image5m, context1h, mode, position, user_id, user_api_key } = req.body;

  // Validate user
  const user = await checkUser(user_id);
  if (!user) return res.status(401).json({ error: 'User tidak ditemukan. Silakan login ulang.' });
  if (user.status === 'pending') return res.status(403).json({ error: 'Akun menunggu approval dari admin.' });
  if (user.status === 'banned') return res.status(403).json({ error: 'Akses ditolak.' });

  // Use user's own API key if provided, else fallback to env
  const apiKey = user_api_key || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key tidak tersedia.' });

  if (!image5m) return res.status(400).json({ error: 'Chart 5M wajib diupload' });

  const isExitMode = mode === 'exit';

  const systemPrompt = `Kamu adalah JSM DCP 9.1 FAST - AI agent untuk analisa LP (Liquidity Provider) SOL/USDC di Orca (Solana).

PRINSIP LP YANG WAJIB KAMU PAHAMI:
- SIDEWAYS = KONDISI TERBAIK untuk LP (fee terus terkumpul)
- SIDEWAYS BERKEPANJANGAN = justru bagus, bukan risiko
- Yang berbahaya HANYA: STRONG DOWNTREND yang push harga keluar range bawah
- Profit dari: fee earned + apresiasi harga SOL
- "Tidak ada momentum bullish" BUKAN alasan untuk WAIT - itu justru kondisi ideal LP
- Gunakan "deploy LP" bukan "entry long" atau "buy"
- Target: +0.5% total return per cycle (fee + apresiasi SOL)

${isExitMode ? `
MODE: EXIT CHECK
Analisa apakah posisi LP aktif sebaiknya ditarik sekarang.
4 EXIT SIGNAL yang perlu dicek:
1. Harga mendekati batas bawah range (< 0.3% dari lower bound)
2. Strong bearish momentum (bukan sideways biasa)
3. PnL sudah >= target 0.5%
4. Waktu deploy sudah > 4 jam tanpa progress

Return JSON:
{
  "mode": "exit",
  "exit_signal": true/false,
  "urgency": "SEGERA" / "MONITOR" / "TAHAN",
  "reasons": ["alasan 1", "alasan 2"],
  "recommendation": "penjelasan singkat",
  "pnl_estimate": "+0.XX%"
}
` : `
MODE: ENTRY SCAN
Analisa setup LP berdasarkan 3 kondisi fleksibel:

KONDISI A - POSISI vs PIVOT POINT:
- FAVORABLE (40 pts): Harga dekat/di bawah Pivot Point harian
- NEUTRAL (20 pts): Harga di tengah range
- UNFAVORABLE (0 pts): Harga jauh di atas resistance

KONDISI B - STRUKTUR 1H:
- IDEAL (35 pts): Ranging / sideways / konsolidasi
- OK (20 pts): Pullback dalam uptrend
- BURUK (0 pts): Strong downtrend aktif

KONDISI C - STABILISASI 5M:
- OK (25 pts): Ada stabilisasi, volume normal/menurun
- LEMAH (10 pts): Masih volatile tapi tidak crash

SCORING:
- >= 60: DEPLOY LP
- 45-59: STANDBY
- < 45: WAIT

CAPITAL ALLOCATION:
- Score >= 80 + B=IDEAL: 100%
- Score 60-79 + B=IDEAL: 60%
- Score 60+ + B=OK: 30%

DILARANG KERAS:
- Menyebut sideways sebagai risiko
- Menggunakan "momentum bullish" sebagai syarat entry
- Framing seperti trading directional

Return JSON:
{
  "mode": "entry",
  "score": 0-100,
  "verdict": "DEPLOY" / "STANDBY" / "WAIT",
  "capital": "100%" / "60%" / "30%" / "0%",
  "kondisi": {
    "A": { "label": "FAVORABLE/NEUTRAL/UNFAVORABLE", "pts": 0 },
    "B": { "label": "IDEAL/OK/BURUK", "pts": 0 },
    "C": { "label": "OK/LEMAH", "pts": 0 }
  },
  "pivot_point": 0.00,
  "entry_zone": "XX.XX - XX.XX",
  "range_lp": "XX.XX - XX.XX (X.X%)",
  "target_return": "+0.5% estimasi total (fee + apresiasi SOL)",
  "capital_usd": "XX%",
  "support_1h": 0.00,
  "resistance_1h": 0.00,
  "exit_trigger": "tarik jika harga mendekati XX.XX atau PnL >= 0.5%",
  "analisa": "penjelasan 2-3 kalimat",
  "wait_reason": null
}
`}

PENTING: Return HANYA JSON valid, tanpa teks tambahan.`;

  const userContent = [];

  if (context1h) {
    userContent.push({ type: 'text', text: `1H CONTEXT:\n${context1h}\n\n` });
  }

  userContent.push({
    type: 'image',
    source: { type: 'base64', media_type: 'image/png', data: image5m }
  });

  if (isExitMode && position) {
    userContent.push({ type: 'text', text: `\nPOSISI AKTIF:\nRange: ${position.range}\nDeploy: ${position.deployTime}\nPnL saat ini: ${position.pnl}%\nFee earned: $${position.fee}` });
  }

  userContent.push({ type: 'text', text: isExitMode ? 'Analisa exit signal untuk posisi LP aktif ini.' : 'Analisa setup LP untuk chart 5M ini.' });

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
        max_tokens: 1000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userContent }]
      })
    });

    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data.error?.message || 'API error' });

    const text = data.content[0].text.trim().replace(/```json|```/g, '').trim();
    const result = JSON.parse(text);

    // Log usage (non-blocking)
    const tokens = (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0);
    logUsage(user_id, tokens);

    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ error: 'Gagal analisa: ' + err.message });
  }
}
