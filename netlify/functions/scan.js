const https = require('https');
exports.handler = async function(event) {
  const h = {'Access-Control-Allow-Origin':'*','Content-Type':'application/json'};
  if(event.httpMethod==='OPTIONS') return {statusCode:200,headers:h,body:''};
  if(event.httpMethod!=='POST') return {statusCode:405,headers:h,body:'Method not allowed'};
  try {
    const b = JSON.parse(event.body||'{}');
    if(!b.imageBase64) return {statusCode:400,headers:h,body:JSON.stringify({error:'No image provided'})};
    const msgs = [{role:'user',content:[
      {type:'image_url',image_url:{url:'data:'+(b.mimeType||'image/jpeg')+';base64,'+b.imageBase64}},
      {type:'text',text:'Analyse this food image carefully. Identify every food item visible. For each item estimate the portion size based on visual cues. Respond ONLY with valid JSON, no other text:\n{"foods":[{"name":"Food Name","portion":"150g","cal":250,"pro":20,"carb":15,"fat":8,"fiber":2}],"total":{"cal":250,"pro":20,"carb":15,"fat":8},"confidence":"high","notes":"any notes"}'}
    ]}];
    const payload = JSON.stringify({model:'meta-llama/llama-4-scout-17b-16e-instruct',max_tokens:1000,messages:msgs,temperature:0.1});
    const res = await new Promise((resolve,reject)=>{
      const req = https.request({
        hostname:'api.groq.com',path:'/openai/v1/chat/completions',method:'POST',
        headers:{'Content-Type':'application/json','Authorization':'Bearer '+process.env.GROQ_API_KEY,'Content-Length':Buffer.byteLength(payload)}
      },(r)=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>resolve({status:r.statusCode,body:d}));});
      req.on('error',reject);req.write(payload);req.end();
    });
    const data = JSON.parse(res.body);
    if(data.choices&&data.choices[0]){
      const text = data.choices[0].message.content;
      const match = text.match(/\{[\s\S]*\}/);
      if(match){
        try{
          const parsed = JSON.parse(match[0]);
          return {statusCode:200,headers:h,body:JSON.stringify(parsed)};
        }catch(e){}
      }
      return {statusCode:200,headers:h,body:JSON.stringify({error:'Could not parse food data',raw:text.substring(0,200)})};
    }
    return {statusCode:500,headers:h,body:JSON.stringify({error:'No response from AI'})};
  } catch(e){ return {statusCode:500,headers:h,body:JSON.stringify({error:e.message})}; }
};
