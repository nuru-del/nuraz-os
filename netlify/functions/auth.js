const https = require('https');

function sbReq(hostname, path, method, body, token, extra) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const headers = {
      'Content-Type': 'application/json',
      'apikey': process.env.SUPABASE_ANON_KEY,
    };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    if (extra) Object.assign(headers, extra);
    if (payload) headers['Content-Length'] = Buffer.byteLength(payload);
    const req = https.request({ hostname, path, method, headers }, (r) => {
      let d = ''; r.on('data', c => d += c); r.on('end', () => resolve({ status: r.statusCode, body: d }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

exports.handler = async function(event) {
  const h = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: h, body: '' };
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY)
    return { statusCode: 500, headers: h, body: JSON.stringify({ error: 'Missing SUPABASE_URL or SUPABASE_ANON_KEY' }) };

  const hn = (process.env.SUPABASE_URL || '').replace(/^https?:\/\//, '').replace(/\/$/, '').split('/')[0];

  try {
    const { action, email, password, token, data, username, friendUsername, challenge } = JSON.parse(event.body || '{}');

    // SIGN UP
    if (action === 'signup') {
      if (!username || username.length < 3)
        return { statusCode: 400, headers: h, body: JSON.stringify({ error: 'Username must be at least 3 characters' }) };
      // Check username taken
      const checkRes = await sbReq(hn, '/rest/v1/profiles?username=eq.' + encodeURIComponent(username) + '&select=id', 'GET', null, null);
      const existing = JSON.parse(checkRes.body);
      if (Array.isArray(existing) && existing.length > 0)
        return { statusCode: 400, headers: h, body: JSON.stringify({ error: 'Username already taken' }) };
      // Create auth user
      const res = await sbReq(hn, '/auth/v1/signup', 'POST', { email, password });
      const r = JSON.parse(res.body);
      if (r.error) return { statusCode: 400, headers: h, body: JSON.stringify({ error: r.error.message || r.error }) };
      const userId = r.user && r.user.id;
      const userToken = r.session && r.session.access_token;
      // Create profile
      if (userId && userToken) {
        await sbReq(hn, '/rest/v1/profiles', 'POST', { id: userId, username: username }, userToken, { 'Prefer': 'resolution=merge-duplicates' });
      }
      return { statusCode: 200, headers: h, body: JSON.stringify({ user: r.user, session: r.session || r, username }) };
    }

    // SIGN IN
    if (action === 'signin') {
      const res = await sbReq(hn, '/auth/v1/token?grant_type=password', 'POST', { email, password });
      const r = JSON.parse(res.body);
      if (r.error) return { statusCode: 400, headers: h, body: JSON.stringify({ error: r.error.message || r.error }) };
      if (!r.access_token) return { statusCode: 400, headers: h, body: JSON.stringify({ error: 'Invalid email or password' }) };
      // Get username
      const profRes = await sbReq(hn, '/rest/v1/profiles?id=eq.' + r.user.id + '&select=username', 'GET', r.access_token);
      const prof = JSON.parse(profRes.body);
      const uname = Array.isArray(prof) && prof.length > 0 ? prof[0].username : null;
      return { statusCode: 200, headers: h, body: JSON.stringify({ user: r.user, session: r, username: uname }) };
    }

    // SAVE DATA
    if (action === 'save') {
      if (!token || !data || !data.userId) return { statusCode: 400, headers: h, body: JSON.stringify({ error: 'Missing data' }) };
      await sbReq(hn, '/rest/v1/user_data', 'POST',
        { id: data.userId, data: data.payload, updated_at: new Date().toISOString() },
        token, { 'Prefer': 'resolution=merge-duplicates' });
      return { statusCode: 200, headers: h, body: JSON.stringify({ ok: true }) };
    }

    // LOAD DATA
    if (action === 'load') {
      if (!token) return { statusCode: 400, headers: h, body: JSON.stringify({ error: 'Missing token' }) };
      const res = await sbReq(hn, '/rest/v1/user_data?select=data&limit=1', 'GET', null, token);
      const r = JSON.parse(res.body);
      if (Array.isArray(r) && r.length > 0) return { statusCode: 200, headers: h, body: JSON.stringify({ data: r[0].data }) };
      return { statusCode: 200, headers: h, body: JSON.stringify({ data: null }) };
    }

    // SEARCH USER BY USERNAME
    if (action === 'findUser') {
      if (!friendUsername) return { statusCode: 400, headers: h, body: JSON.stringify({ error: 'No username provided' }) };
      const res = await sbReq(hn, '/rest/v1/profiles?username=eq.' + encodeURIComponent(friendUsername) + '&select=id,username', 'GET', null, token);
      const r = JSON.parse(res.body);
      if (!Array.isArray(r) || r.length === 0) return { statusCode: 404, headers: h, body: JSON.stringify({ error: 'User not found' }) };
      return { statusCode: 200, headers: h, body: JSON.stringify({ user: r[0] }) };
    }

    // CREATE CHALLENGE
    if (action === 'createChallenge') {
      if (!token || !challenge) return { statusCode: 400, headers: h, body: JSON.stringify({ error: 'Missing data' }) };
      const res = await sbReq(hn, '/rest/v1/challenges', 'POST', challenge, token, { 'Prefer': 'return=representation' });
      const r = JSON.parse(res.body);
      return { statusCode: 200, headers: h, body: JSON.stringify({ challenge: Array.isArray(r) ? r[0] : r }) };
    }

    // GET MY CHALLENGES
    if (action === 'getChallenges') {
      if (!token || !data || !data.userId) return { statusCode: 400, headers: h, body: JSON.stringify({ error: 'Missing data' }) };
      const uid = data.userId;
      const res = await sbReq(hn, '/rest/v1/challenges?or=(creator_id.eq.' + uid + ',opponent_id.eq.' + uid + ')&order=created_at.desc&limit=20', 'GET', null, token);
      const r = JSON.parse(res.body);
      return { statusCode: 200, headers: h, body: JSON.stringify({ challenges: Array.isArray(r) ? r : [] }) };
    }

    // GET OPPONENT STATS (their public data for challenge comparison)
    if (action === 'getOpponentStats') {
      if (!token || !data || !data.opponentId) return { statusCode: 400, headers: h, body: JSON.stringify({ error: 'Missing data' }) };
      // Get their user_data
      const res = await sbReq(hn, '/rest/v1/user_data?id=eq.' + data.opponentId + '&select=data', 'GET', null, token);
      const r = JSON.parse(res.body);
      // Only return safe public stats, not full data
      if (Array.isArray(r) && r.length > 0 && r[0].data) {
        const d = r[0].data;
        const gym = d.gym || [];
        const meals = d.meals || [];
        const now = new Date();
        const weekAgo = new Date(now - 7 * 86400000);
        const weekSessions = gym.filter(function(s) { return new Date(s.date) > weekAgo && s.type !== 'Rest Day'; }).length;
        const weekMeals = meals.filter(function(m) { return new Date(m.date) > weekAgo; });
        const proGoal = d.proGoal || 130;
        const daysHitPro = {};
        weekMeals.forEach(function(m) {
          const dk = new Date(m.date).toDateString();
          daysHitPro[dk] = (daysHitPro[dk] || 0) + m.pro;
        });
        const proHitDays = Object.values(daysHitPro).filter(function(p) { return p >= proGoal; }).length;
        return { statusCode: 200, headers: h, body: JSON.stringify({ stats: { weekSessions, proHitDays, name: d.profile && d.profile.name || 'Opponent' } }) };
      }
      return { statusCode: 200, headers: h, body: JSON.stringify({ stats: null }) };
    }

    return { statusCode: 400, headers: h, body: JSON.stringify({ error: 'Unknown action: ' + action }) };
  } catch (e) {
    return { statusCode: 500, headers: h, body: JSON.stringify({ error: e.message }) };
  }
};
