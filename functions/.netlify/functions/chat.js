// Cloudflare Pages Function — ported from Netlify chat.js (Groq AI coach).
// Env: GROQ_API_KEY
const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
const J = (status, obj) => new Response(JSON.stringify(obj), { status, headers: CORS });

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response('', { status: 200, headers: CORS });
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: CORS });
  try {
    const b = await request.json().catch(() => ({}));
    const msgs = [{ role: 'system', content: b.system || 'You are a helpful fitness coach.' }, ...(b.messages || [])];
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + env.GROQ_API_KEY },
      body: JSON.stringify({ model: 'llama-3.3-70b-versatile', max_tokens: 1000, messages: msgs }),
    });
    const data = await res.json();
    if (data.choices && data.choices[0])
      return J(200, { content: [{ type: 'text', text: data.choices[0].message.content }] });
    return J(500, { error: 'No response from AI' });
  } catch (e) { return J(500, { error: e.message }); }
}
