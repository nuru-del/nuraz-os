const https = require('https');
exports.handler = async function(event) {
  const h = {'Access-Control-Allow-Origin':'*','Content-Type':'application/json'};
  if(event.httpMethod==='OPTIONS') return {statusCode:200,headers:h,body:''};
  if(event.httpMethod!=='POST') return {statusCode:405,headers:h,body:'Method not allowed'};
  try {
    const b = JSON.parse(event.body||'{}');
    const msgs = [{role:'system',content:b.system||'You are a helpful fitness coach.'},...(b.messages||[])];
    const payload = JSON.stringify({model:'llama-3.3-70b-versatile',max_tokens:1000,messages:msgs});
    const res = await new Promise((resolve,reject)=>{
      const req = https.request({hostname:'api.groq.com',path:'/openai/v1/chat/completions',method:'POST',
        headers:{'Content-Type':'application/json','Authorization':'Bearer '+process.env.GROQ_API_KEY,'Content-Length':Buffer.byteLength(payload)}
      },(r)=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>resolve({status:r.statusCode,body:d}));});
      req.on('error',reject);req.write(payload);req.end();
    });
    const data = JSON.parse(res.body);
    if(data.choices&&data.choices[0]){
      return {statusCode:200,headers:h,body:JSON.stringify({content:[{type:'text',text:data.choices[0].message.content}]})};
    }
    return {statusCode:500,headers:h,body:JSON.stringify({error:'No response from AI'})};
  } catch(e){ return {statusCode:500,headers:h,body:JSON.stringify({error:e.message})}; }
};
