// Cloudflare Pages Function — ported from Netlify auth.js. Same actions/logic.
// Serves /.netlify/functions/auth so the app needs no changes.
// Env (set in Cloudflare Pages dashboard): SUPABASE_URL, SUPABASE_ANON_KEY
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};
const J = (status, obj) => new Response(JSON.stringify(obj), { status, headers: CORS });

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response('', { status: 200, headers: CORS });
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY)
    return J(500, { error: 'Missing SUPABASE_URL or SUPABASE_ANON_KEY' });

  const base = env.SUPABASE_URL.replace(/\/$/, '');
  async function sb(path, method, body, token, extra) {
    const headers = { 'Content-Type': 'application/json', apikey: env.SUPABASE_ANON_KEY };
    if (token) headers.Authorization = 'Bearer ' + token;
    if (extra) Object.assign(headers, extra);
    const res = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.text() };
  }

  try {
    const { action, email, password, token, data, username, friendUsername, challenge } =
      await request.json().catch(() => ({}));

    if (action === 'signup') {
      if (!username || username.length < 3) return J(400, { error: 'Username must be at least 3 characters' });
      const check = await sb('/rest/v1/profiles?username=eq.' + encodeURIComponent(username) + '&select=id', 'GET', null, null);
      const existing = JSON.parse(check.body || '[]');
      if (Array.isArray(existing) && existing.length > 0) return J(400, { error: 'Username already taken' });
      const res = await sb('/auth/v1/signup', 'POST', { email, password });
      const r = JSON.parse(res.body);
      if (r.error) return J(400, { error: r.error.message || r.error });
      const userId = r.user && r.user.id, userToken = r.session && r.session.access_token;
      if (userId && userToken)
        await sb('/rest/v1/profiles', 'POST', { id: userId, username }, userToken, { Prefer: 'resolution=merge-duplicates' });
      return J(200, { user: r.user, session: r.session || r, username });
    }

    if (action === 'signin') {
      const res = await sb('/auth/v1/token?grant_type=password', 'POST', { email, password });
      const r = JSON.parse(res.body);
      if (r.error) return J(400, { error: r.error.message || r.error });
      if (!r.access_token) return J(400, { error: 'Invalid email or password' });
      const profRes = await sb('/rest/v1/profiles?id=eq.' + r.user.id + '&select=username', 'GET', r.access_token);
      const prof = JSON.parse(profRes.body || '[]');
      const uname = Array.isArray(prof) && prof.length > 0 ? prof[0].username : null;
      return J(200, { user: r.user, session: r, username: uname });
    }

    if (action === 'save') {
      if (!token || !data || !data.userId) return J(400, { error: 'Missing data' });
      await sb('/rest/v1/user_data', 'POST',
        { id: data.userId, data: data.payload, updated_at: new Date().toISOString() },
        token, { Prefer: 'resolution=merge-duplicates' });
      return J(200, { ok: true });
    }

    if (action === 'load') {
      if (!token) return J(400, { error: 'Missing token' });
      const res = await sb('/rest/v1/user_data?select=data&limit=1', 'GET', null, token);
      const r = JSON.parse(res.body || '[]');
      return J(200, { data: Array.isArray(r) && r.length > 0 ? r[0].data : null });
    }

    if (action === 'findUser') {
      if (!friendUsername) return J(400, { error: 'No username provided' });
      const res = await sb('/rest/v1/profiles?username=eq.' + encodeURIComponent(friendUsername) + '&select=id,username', 'GET', null, token);
      const r = JSON.parse(res.body || '[]');
      if (!Array.isArray(r) || r.length === 0) return J(404, { error: 'User not found' });
      return J(200, { user: r[0] });
    }

    if (action === 'createChallenge') {
      if (!token || !challenge) return J(400, { error: 'Missing data' });
      const res = await sb('/rest/v1/challenges', 'POST', challenge, token, { Prefer: 'return=representation' });
      const r = JSON.parse(res.body);
      return J(200, { challenge: Array.isArray(r) ? r[0] : r });
    }

    if (action === 'getChallenges') {
      if (!token || !data || !data.userId) return J(400, { error: 'Missing data' });
      const uid = data.userId;
      const res = await sb('/rest/v1/challenges?or=(creator_id.eq.' + uid + ',opponent_id.eq.' + uid + ')&order=created_at.desc&limit=20', 'GET', null, token);
      const r = JSON.parse(res.body || '[]');
      return J(200, { challenges: Array.isArray(r) ? r : [] });
    }

    if (action === 'getOpponentStats') {
      if (!token || !data || !data.opponentId) return J(400, { error: 'Missing data' });
      const res = await sb('/rest/v1/user_data?id=eq.' + data.opponentId + '&select=data', 'GET', null, token);
      const r = JSON.parse(res.body || '[]');
      if (Array.isArray(r) && r.length > 0 && r[0].data) {
        const d = r[0].data, gym = d.gym || [], meals = d.meals || [];
        const weekAgo = new Date(Date.now() - 7 * 86400000);
        const weekSessions = gym.filter(s => new Date(s.date) > weekAgo && s.type !== 'Rest Day').length;
        const proGoal = d.proGoal || 130, daysHitPro = {};
        meals.filter(m => new Date(m.date) > weekAgo).forEach(m => {
          const dk = new Date(m.date).toDateString();
          daysHitPro[dk] = (daysHitPro[dk] || 0) + m.pro;
        });
        const proHitDays = Object.values(daysHitPro).filter(p => p >= proGoal).length;
        return J(200, { stats: { weekSessions, proHitDays, name: (d.profile && d.profile.name) || 'Opponent' } });
      }
      return J(200, { stats: null });
    }

    return J(400, { error: 'Unknown action: ' + action });
  } catch (e) {
    return J(500, { error: e.message });
  }
}
