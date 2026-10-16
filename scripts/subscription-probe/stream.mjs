// Responses streaming parser shared by the device test and local tests.
export function catalogModels(catalog) {
  const rows = Array.isArray(catalog.models) ? catalog.models : Array.isArray(catalog.data) ? catalog.data : [];
  return rows.filter(m => !m.visibility || m.visibility === 'list').map(m => ({slug:m.slug ?? m.id, name:m.display_name ?? m.id ?? m.slug})).filter(m=>typeof m.slug==='string');
}
export function completedText(body) {
  let text = '', terminal, usage;
  for (const block of body.replace(/\r\n/g,'\n').split('\n\n')) {
    const data = block.split('\n').filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');
    if (!data || data === '[DONE]') continue;
    const event = JSON.parse(data);
    if (event.type === 'response.failed' || event.type === 'error' || event.type === 'response.incomplete') {
      const code = event.response?.error?.code || event.code || 'incomplete_response';
      throw Error(`Subscription request stopped: ${String(code).replace(/[^a-zA-Z0-9_-]/g,'').slice(0,100)}`);
    }
    if (terminal) continue;
    if (event.type === 'response.output_text.delta') text += event.delta ?? '';
    if (event.type === 'response.completed') {
      terminal = event.response;
      usage = terminal?.usage;
      if (!text) text = (terminal?.output ?? []).flatMap(o=>o.content ?? []).filter(c=>c.type==='output_text').map(c=>c.text ?? '').join('\n');
    }
  }
  if (!terminal || terminal.status !== 'completed' || !text.trim()) throw Error('Subscription stream did not complete with text');
  return {text, usage};
}
export function pageRequest(model, image, instructions) {
  if (!['gpt-6.1-sol','gpt-5.6-sol'].includes(model) || !/^data:image\/png;base64,/.test(image) || image.length > 12000000) throw Error('Invalid isolated page request');
  return {model, store:false, stream:true, reasoning:{effort:'low'}, instructions,
    input:[{role:'user',content:[{type:'input_text',text:'Transcribe this one handwritten page as Markdown. Return only the transcription. Use [...] for unclear words. Keep the answer below 1500 words.'},{type:'input_image',image_url:image,detail:'high'}]}]};
}

// One explicitly requested model attempt, then one fallback only for model-access rejection.
// Quota, transport and incomplete-stream errors stop to avoid duplicate billable work.
export async function recognizeWithFallback(send) {
  const attempts=[];
  for(const model of ['gpt-6.1-sol','gpt-5.6-sol']) {
    const r=await send(model);
    const code=String(r.error?.code ?? '').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,100);
    attempts.push({model,status:r.status,...(code?{code}:{})});
    if(r.status===200)return {model,output:completedText(r.text),attempts};
    const unavailable=['model_not_found','model_not_available','model_not_supported'].includes(code) ||
      ([400,403,404].includes(r.status) && /model/i.test(r.error?.message ?? '') && /does not exist|not available|do not have access|not have access|not supported/i.test(r.error?.message ?? ''));
    if(model==='gpt-6.1-sol' && unavailable)continue;
    throw Error(`Subscription recognition stopped (HTTP ${r.status}${code?', '+code:''}). No API fallback.`);
  }
  throw Error('No subscription model completed');
}
