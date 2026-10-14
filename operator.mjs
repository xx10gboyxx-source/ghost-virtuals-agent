import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,chmodSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {initialCryptoState,startCrypto,pauseCrypto,runCryptoSimulation} from './server/polymarket-crypto-engine.mjs';
import {createPolymarketUSFeed} from './server/polymarket-us-feed.mjs';

export const AGENT_ID='ghost-virtuals-agent';

// This operator contains no exchange credentials, ACP signer or live-order client.
// Installation on a persistent host is separate from generating this package.
export class GrokOperator {
 constructor(path,{clock=Date.now,feed}={}) {
  this.clock=clock;this.feed=feed||createPolymarketUSFeed({now:clock});
  mkdirSync(dirname(resolve(path)),{recursive:true,mode:0o700});
  this.db=new DatabaseSync(path);chmodSync(path,0o600);
  this.db.exec('PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS ghost_grok (id INTEGER PRIMARY KEY, agent TEXT NOT NULL, payload TEXT NOT NULL, lease_token TEXT, lease_until INTEGER NOT NULL DEFAULT 0);');
  const state=initialCryptoState('simulation');state.cash=50;
  this.db.prepare('INSERT OR IGNORE INTO ghost_grok(id,agent,payload) VALUES(1,?,?)').run(AGENT_ID,JSON.stringify(state));
  this.read();
 }
 read(){
  const row=this.db.prepare('SELECT * FROM ghost_grok WHERE id=1').get();
  const state=JSON.parse(row.payload);
  if(row.agent!==AGENT_ID||state.mode!=='simulation')throw new Error('Wrong agent or ledger mode. No action performed.');
  return state;
 }
 status(){const s=this.read();return {agentId:AGENT_ID,strategy:'grok_high_prob',mode:'simulation',liveOrders:false,enabled:s.enabled,sessionUntil:s.sessionUntil,cash:s.cash,realized:s.realized,feesPaid:s.feesPaid,positions:s.positions,orders:s.orders,diagnostics:s.diagnostics,lastTick:s.lastTick};}
 async action(command){
  if(!['start','pause','tick'].includes(command))throw new Error('Only start, pause and tick are supported. Live orders are unavailable.');
  const token=crypto.randomUUID(),at=this.clock();
  const claim=this.db.prepare('UPDATE ghost_grok SET lease_token=?,lease_until=? WHERE id=1 AND (lease_token IS NULL OR lease_until<=?)').run(token,at+120000,at);
  if(!claim.changes)throw new Error('Another worker owns the ledger. Wait for its check to complete.');
  try {
   const state=this.read();
   if(command==='start')startCrypto(state,at);
   if(command==='pause')pauseCrypto(state,at);
   if(command==='tick')await runCryptoSimulation(state,this.feed,this.clock);
   const saved=this.db.prepare('UPDATE ghost_grok SET payload=?,lease_token=NULL,lease_until=0 WHERE id=1 AND lease_token=? AND lease_until>?').run(JSON.stringify(state),token,this.clock());
   if(!saved.changes)throw new Error('Worker lease expired; results were not saved.');
   return this.status();
  } finally {this.db.prepare('UPDATE ghost_grok SET lease_token=NULL,lease_until=0 WHERE id=1 AND lease_token=?').run(token);}
 }
 close(){this.db.close();}
}

export async function main(args){
 const [command='status',path='./state/ghost-grok.sqlite']=args;
 if(args.length>2||!['status','start','pause','tick','run'].includes(command))throw new Error('Use status, start, pause, tick or run with one optional database path.');
 const operator=new GrokOperator(path);let stopped=false;
 const stop=()=>{stopped=true;};process.on('SIGINT',stop);process.on('SIGTERM',stop);
 try {
  if(command==='status')return operator.status();
  if(command!=='run')return await operator.action(command);
  // run resumes the stored session; it never starts or extends one automatically.
  while(!stopped){
   const s=operator.read();
   if(!s.enabled&&!s.positions.length&&!s.orders.some(o=>['PENDING','PARTIAL'].includes(o.status)))break;
   const result=await operator.action('tick');process.stdout.write(JSON.stringify(result)+'\n');
   if(!stopped)await new Promise(r=>setTimeout(r,5000));
  }
  return operator.status();
 } finally {process.off('SIGINT',stop);process.off('SIGTERM',stop);operator.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 main(process.argv.slice(2)).then(r=>process.stdout.write(JSON.stringify(r)+'\n')).catch(e=>{process.stderr.write(JSON.stringify({error:e.message})+'\n');process.exitCode=1;});
}
