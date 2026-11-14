/** Decode SSE incrementally, then return the native final response for validation. */
export async function collectProviderStream(response: Response, protocol: string, onText: (text:string)=>void, onActivity?: () => void): Promise<any> {
  if (!response.body) throw new Error('API stream has no body.');
  const reader=response.body.getReader(), decoder=new TextDecoder();
  let buffer='', complete=false;
  const chat:any={choices:[{message:{content:'',tool_calls:[]}}]};
  let native:any={content:[],usage:{}};
  const calls=new Map<number,any>();
  function event(frame:string) {
    const payload=frame.split('\n').filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');
    if(!payload) return;
    if(payload==='[DONE]') {complete=true;return;}
    const e=JSON.parse(payload);
    onActivity?.();
    if(e.error || e.type==='error') throw new Error('Provider reported a streaming error.');
    if(protocol==='openai') {
      if(e.usage) chat.usage=e.usage;
      const c=e.choices?.[0]; if(!c) return;
      const d=c.delta||{};
      if(d.content) {chat.choices[0].message.content+=d.content;onText(d.content);}
      for(const t of d.tool_calls||[]) {
        const v=calls.get(t.index)||{id:'',function:{name:'',arguments:''}};
        if(t.id) v.id=t.id;
        v.function.name+=t.function?.name||'';v.function.arguments+=t.function?.arguments||'';
        calls.set(t.index,v);
      }
      if(c.finish_reason) {chat.choices[0].finish_reason=c.finish_reason;complete=true;}
    } else if(protocol==='responses') {
      if(e.type==='response.output_text.delta') onText(e.delta);
      if(e.type==='response.completed') {native=e.response;complete=true;}
      if(['response.failed','response.incomplete'].includes(e.type)) throw new Error('API stream did not complete.');
    } else if(protocol==='anthropic') {
      if(e.type==='message_start') native={...e.message,content:[]};
      if(e.type==='content_block_start') native.content[e.index]={...e.content_block,_json:''};
      if(e.type==='content_block_delta') {
        const b=native.content[e.index]; if(!b) throw new Error('Invalid stream block.');
        if(e.delta.text) {b.text=(b.text||'')+e.delta.text;onText(e.delta.text);}
        if(e.delta.partial_json) b._json+=e.delta.partial_json;
        if(e.delta.thinking) b.thinking=(b.thinking||'')+e.delta.thinking;
        if(e.delta.signature) b.signature=(b.signature||'')+e.delta.signature;
      }
      if(e.type==='content_block_stop') {const b=native.content[e.index];if(b?._json) b.input=JSON.parse(b._json);}
      if(e.type==='message_delta') {Object.assign(native,e.delta);Object.assign(native.usage,e.usage);}
      if(e.type==='message_stop') complete=true;
    } else {
      const c=e.candidates?.[0];
      if(c) {
        native.candidates??=[{content:{parts:[]}}];
        for(const p of c.content?.parts||[]) {native.candidates[0].content.parts.push(p);if(p.text&&!p.thought) onText(p.text);}
        if(c.finishReason) {native.candidates[0].finishReason=c.finishReason;complete=true;}
      }
      if(e.usageMetadata) native.usageMetadata=e.usageMetadata;
    }
  }
  try {
    while(true) {
      const {value,done}=await reader.read();
      buffer+=decoder.decode(value,{stream:!done}).replace(/\r\n/g,'\n');
      let end:number;while((end=buffer.indexOf('\n\n'))>=0) {event(buffer.slice(0,end));buffer=buffer.slice(end+2);}
      if(done) break;
    }
    if(buffer.trim()) event(buffer);
    if(!complete) throw new Error('API stream ended before completion. No tools executed.');
    chat.choices[0].message.tool_calls=[...calls.values()];
    return protocol==='openai'?chat:native;
  } finally {await reader.cancel().catch(()=>{});reader.releaseLock();}
}
