const SUPABASE_URL = `https://${process.env.SUPABASE_PROJECT_ID}.supabase.co`;
const SUPABASE_SECRET = process.env.SUPABASE_SECRET_KEY;

async function supabase(method, path, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method,
    headers: {
      'apikey': SUPABASE_SECRET,
      'Authorization': `Bearer ${SUPABASE_SECRET}`,
      'Content-Type': 'application/json',
      'Prefer': method === 'POST' ? 'return=representation' : 'return=representation'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  try { return { ok: res.ok, status: res.status, data: JSON.parse(text) }; }
  catch { return { ok: res.ok, status: res.status, data: text }; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-key');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const adminKey = process.env.ADMIN_SECRET_KEY;
  const isAdmin = req.headers['x-admin-key'] === adminKey;

  // POST /api/auth - Register new user
  if (req.method === 'POST') {
    const { name, api_key } = req.body;
    if (!name || !api_key) return res.status(400).json({ error: 'name dan api_key wajib diisi' });

    // Store only hint of API key for security
    const api_key_hint = api_key.substring(0, 15) + '...' + api_key.slice(-4);

    // Check if name already exists
    const existing = await supabase('GET', `/users?name=eq.${encodeURIComponent(name)}&select=id,status`);
    if (existing.ok && existing.data.length > 0) {
      const user = existing.data[0];
      if (user.status === 'banned') return res.status(403).json({ error: 'Akses ditolak.' });
      return res.status(200).json({ 
        user_id: user.id, 
        status: user.status,
        message: user.status === 'active' ? 'Login berhasil' : 'Menunggu approval admin'
      });
    }

    // Create new user
    const result = await supabase('POST', '/users', { name, api_key_hint, status: 'pending' });
    if (!result.ok) return res.status(500).json({ error: 'Gagal register' });

    return res.status(201).json({ 
      user_id: result.data[0].id, 
      status: 'pending',
      message: 'Registrasi berhasil. Menunggu approval admin.'
    });
  }

  // GET /api/auth?action=check&user_id=xxx - Check user status
  if (req.method === 'GET' && req.query.action === 'check') {
    const { user_id } = req.query;
    if (!user_id) return res.status(400).json({ error: 'user_id required' });

    const result = await supabase('GET', `/users?id=eq.${user_id}&select=id,name,status,last_active`);
    if (!result.ok || result.data.length === 0) return res.status(404).json({ error: 'User tidak ditemukan' });

    const user = result.data[0];
    if (user.status === 'banned') return res.status(403).json({ error: 'Akses ditolak.' });

    // Update last_active
    await supabase('PATCH', `/users?id=eq.${user_id}`, { last_active: new Date().toISOString() });

    return res.status(200).json({ user_id: user.id, name: user.name, status: user.status });
  }

  // ADMIN: GET /api/auth?action=admin_users - List all users
  if (req.method === 'GET' && req.query.action === 'admin_users') {
    if (!isAdmin) return res.status(401).json({ error: 'Unauthorized' });

    const users = await supabase('GET', '/users?select=*&order=created_at.desc');
    if (!users.ok) return res.status(500).json({ error: 'Gagal ambil data' });

    // Get usage count per user
    const usageCounts = await supabase('GET', '/usage_logs?select=user_id,cost_usd');
    
    const usageMap = {};
    if (usageCounts.ok) {
      for (const log of usageCounts.data) {
        if (!usageMap[log.user_id]) usageMap[log.user_id] = { count: 0, cost: 0 };
        usageMap[log.user_id].count++;
        usageMap[log.user_id].cost += parseFloat(log.cost_usd || 0);
      }
    }

    const enriched = users.data.map(u => ({
      ...u,
      total_analyses: usageMap[u.id]?.count || 0,
      total_cost_usd: (usageMap[u.id]?.cost || 0).toFixed(4)
    }));

    return res.status(200).json(enriched);
  }

  // ADMIN: PATCH /api/auth - Update user status
  if (req.method === 'PATCH') {
    if (!isAdmin) return res.status(401).json({ error: 'Unauthorized' });

    const { user_id, status } = req.body;
    if (!user_id || !status) return res.status(400).json({ error: 'user_id dan status wajib' });
    if (!['active', 'banned', 'pending'].includes(status)) return res.status(400).json({ error: 'Status tidak valid' });

    const result = await supabase('PATCH', `/users?id=eq.${user_id}`, { status });
    if (!result.ok) return res.status(500).json({ error: 'Gagal update status' });

    return res.status(200).json({ success: true, status });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
