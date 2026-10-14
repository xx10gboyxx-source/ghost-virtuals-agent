// Bounded UTF-8 response reader extracted from the GhOsT implementation.
const fail=(message,status)=>{throw Object.assign(new Error(message),{status});};
export async function readLimitedText(request,maxBytes=10000){
 const declared=request.headers.get('Content-Length');
 if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>maxBytes))fail('Request too large.',413);
 if(!request.body)return '';
 const reader=request.body.getReader(),parts=[];let size=0;
 try{
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;
   if(size>maxBytes){await reader.cancel().catch(()=>{});fail('Request too large.',413);}parts.push(value);
  }
 }finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}
 try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{fail('Invalid request encoding.',400);}
}
