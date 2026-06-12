// Cloudflare Pages Function — ported from Netlify scan.js (Groq vision food scan).
// Env: GROQ_API_KEY
const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
const J = (status, obj) => new Response(JSON.stringify(obj), { status, headers: CORS });

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response('', { status: 200, headers: CORS });
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: CORS });
  try {
    const b = await request.json().catch(() => ({}));
    if (!b.imageBase64) return J(400, { error: 'No image provided' });
    const msgs = [{ role: 'user', content: [
      { type: 'image_url', image_url: { url: 'data:' + (b.mimeType || 'image/jpeg') + ';base64,' + b.imageBase64 } },
      { type: 'text', text: 'Analyse this food image carefully. Identify every food item visible. For each item estimate the portion size based on visual cues. Respond ONLY with valid JSON, no other text:\n{"foods":[{"name":"Food Name","portion":"150g","cal":250,"pro":20,"carb":15,"fat":8,"fiber":2}],"total":{"cal":250,"pro":20,"carb":15,"fat":8},"confidence":"high","notes":"any notes"}' },
    ] }];
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + env.GROQ_API_KEY },
      body: JSON.stringify({ model: 'meta-llama/llama-4-scout-17b-16e-instruct', max_tokens: 1000, messages: msgs, temperature: 0.1 }),
    });
    const data = await res.json();
    if (data.choices && data.choices[0]) {
      const text = data.choices[0].message.content;
      const match = text.match(/\{[\s\S]*\}/);
      if (match) { try { return J(200, JSON.parse(match[0])); } catch (e) {} }
      return J(200, { error: 'Could not parse food data', raw: text.substring(0, 200) });
    }
    return J(500, { error: 'No response from AI' });
  } catch (e) { return J(500, { error: e.message }); }
}
