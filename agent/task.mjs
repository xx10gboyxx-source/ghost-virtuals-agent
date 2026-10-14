import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {GrokOperator} from '../operator.mjs';
import {observation,createVirtualsExplainer} from './reporter.mjs';

export const TASKS=Object.freeze({
  'explain-wait':'Explain why recorded simulation checks pass, wait or block.',
  'session-review':'Review the recorded simulation session and missing evidence.',
});
const MAX_AGE_MS=15000;
const stamp=n=>Number.isSafeInteger(n)&&n>0;
const fresh=(n,now)=>stamp(n)&&n<=now&&now-n<=MAX_AGE_MS;
const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);

// These two local tools receive a sanitized snapshot only. No operator, network,
// filesystem, wallet, order action, arbitrary tool name or model-selected code.
function inspectSession(snapshot,now){
  return [
    {id:'session',source:'simulation-ledger',value:{enabled:snapshot.enabled,sessionUntil:snapshot.sessionUntil,active:snapshot.enabled&&stamp(snapshot.sessionUntil)&&snapshot.sessionUntil>now}},
    {id:'freshness',source:'simulation-ledger',value:{lastTick:snapshot.lastTick,maximumAgeMs:MAX_AGE_MS,fresh:fresh(snapshot.lastTick,now)}},
    {id:'balances',source:'simulation-ledger',value:{cash:snapshot.simulatedCash,realized:snapshot.simulatedRealized,fees:snapshot.simulatedFees,positions:snapshot.positions}},
  ];
}
function inspectChecks(snapshot,now){
  return snapshot.checks.map((check,i)=>({id:`check-${i+1}`,source:'recorded-diagnostic',value:{...check,fresh:fresh(check.checkedAt,now)}}));
}
function assess(evidence,validInput,completeChecks){
  const reasons=[];
  const add=(state,code,evidenceId)=>reasons.push({state,code,evidenceId});
  const [session,freshness,balances,...checks]=evidence;
  if(!session.value.active)add('WAIT','SESSION_INACTIVE','session');
  if(!freshness.value.fresh)add('WAIT','MISSING_STALE_OR_FUTURE_TICK','freshness');
  if(!validInput||![balances.value.cash,balances.value.realized,balances.value.fees].every(Number.isFinite)||balances.value.cash<0||balances.value.fees<0)add('BLOCKED','INVALID_SIMULATION_STATE','balances');
  if(!completeChecks)add('WAIT','INCOMPLETE_DIAGNOSTICS','freshness');
  if(!checks.length)add('WAIT','NO_RECORDED_CHECKS','freshness');
  for(const item of checks){
    if(!item.value.fresh)add('WAIT','STALE_OR_INVALID_CHECK',item.id);
    add(item.value.code==='UNKNOWN'&&item.value.status==='PASS'?'WAIT':item.value.status,item.value.code,item.id);
  }
  const state=reasons.some(r=>r.state==='BLOCKED')?'BLOCKED':reasons.some(r=>r.state==='WAIT')?'WAIT':'PASS';
  return {state,reasons,meaning:'Recorded simulation evidence only; PASS never authorizes a trade.'};
}
function parseExplanation(text,ids){
  if(typeof text!=='string'||text.length>5000)throw new Error('Unsupported explanation.');
  const value=JSON.parse(text);
  if(!record(value)||Object.keys(value).sort().join(',')!=='citations,summary'||typeof value.summary!=='string'||!value.summary.trim()||value.summary.length>1200||!Array.isArray(value.citations)||value.citations.length<1||value.citations.length>8||new Set(value.citations).size!==value.citations.length||!value.citations.every(id=>typeof id==='string'&&ids.has(id)))throw new Error('Invalid evidence references.');
  return {summary:value.summary.trim(),citations:value.citations};
}

export async function runResearchTask({task,status,now=Date.now(),explain=null,timeoutMs=10000}={}){
  if(!Object.hasOwn(TASKS,task)||!stamp(now)||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)throw new Error('Invalid research task, time or deadline.');
  if(status?.mode!=='simulation'||status.liveOrders!==false)throw new Error('Only simulation evidence is accepted.');
  const validInput=typeof status.enabled==='boolean'&&Array.isArray(status.positions)&&Array.isArray(status.orders)&&Array.isArray(status.diagnostics);
  const snapshot=observation({...status,
    orders:Array.isArray(status.orders)?status.orders.filter(record):[],
    diagnostics:Array.isArray(status.diagnostics)?status.diagnostics.map(x=>record(x)?x:{}):[],
  });
  const plan=['observe','inspect_session','inspect_checks','assess','explain'];
  const evidence=[...inspectSession(snapshot,now),...inspectChecks(snapshot,now)];
  const assessment=assess(evidence,validInput,Array.isArray(status.diagnostics)&&status.diagnostics.length<=20);
  const result={schemaVersion:'1.0',agent:'GhOsT',task,goal:TASKS[task],mode:'simulation',liveOrders:false,observedAt:now,
    plan,evidence,assessment,
    trace:plan.map(step=>({step,status:step==='explain'?'disabled':'completed'})),
    inference:{status:'disabled',result:null,untrusted:true,requests:0},
    limitations:['This is a fixed, bounded research workflow, not an autonomous trading service.','Evidence references are checked; semantic accuracy of AI text is not guaranteed.','Synthetic tests do not establish trading profitability or real-provider quality.'],
  };
  if(explain){
    let timer;result.inference.requests=1;
    try{
      const text=await Promise.race([
        Promise.resolve().then(()=>explain(structuredClone({task,goal:TASKS[task],evidence,assessment}))),
        new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Deadline exceeded.')),timeoutMs);}),
      ]);
      result.inference.result=parseExplanation(text,new Set(evidence.map(e=>e.id)));
      result.inference.status='completed';
    }catch{result.inference.status='unavailable';}
    finally{clearTimeout(timer);}
    result.trace.at(-1).status=result.inference.status;
  }
  return result;
}

function fixture(){
  const now=1800000000000;
  return {now,status:{mode:'simulation',liveOrders:false,enabled:true,sessionUntil:now+60000,lastTick:now,cash:50,realized:0,feesPaid:0,positions:[],orders:[],diagnostics:[{status:'PASS',code:'ELIGIBLE',checkedAt:now}]}};
}
export async function evaluateFixtures(){
  const {now,status}=fixture();
  // Expected outcomes are declared independently of the implementation.
  const cases=[
    ['fresh-recorded-pass',{},'PASS'],
    ['paused',{enabled:false},'WAIT'],
    ['expired',{sessionUntil:now},'WAIT'],
    ['missing-tick',{lastTick:0},'WAIT'],
    ['stale-tick',{lastTick:now-15001},'WAIT'],
    ['future-tick',{lastTick:now+1},'WAIT'],
    ['no-checks',{diagnostics:[]},'WAIT'],
    ['stale-check',{diagnostics:[{status:'PASS',code:'ELIGIBLE',checkedAt:now-15001}]},'WAIT'],
    ['risk-block',{diagnostics:[{status:'BLOCKED',code:'RISK_LIMIT',checkedAt:now}]},'BLOCKED'],
    ['invalid-balance',{cash:-1},'BLOCKED'],
  ];
  const outcomes=[];
  for(const [name,patch,expected] of cases){
    const output=await runResearchTask({task:'explain-wait',status:{...status,...patch},now});
    outcomes.push({name,expected,actual:output.assessment.state,passed:output.assessment.state===expected});
  }
  return {kind:'synthetic-behavior-evaluation',liveProviderCalls:0,modelQualityMeasured:false,cases:outcomes,passed:outcomes.filter(x=>x.passed).length,failed:outcomes.filter(x=>!x.passed).length};
}
export async function main(args){
  if(args.length===1&&args[0]==='--evaluate')return evaluateFixtures();
  if(args.length===1&&args[0]==='--demo'){
    const input=fixture();input.status.diagnostics=[{status:'WAIT',code:'STALE_BOOK',checkedAt:input.now}];
    return {kind:'synthetic-offline-task-demo',liveProviderCalls:0,...await runResearchTask({task:'explain-wait',...input})};
  }
  if(args.length!==2||!Object.hasOwn(TASKS,args[0]))throw new Error('Use --demo, --evaluate, or TASK DATABASE_PATH.');
  const explain=createVirtualsExplainer({enabled:process.env.GHOST_ENABLE_INFERENCE==='true',apiKey:process.env.VIRTUALS_API_KEY||'',model:process.env.VIRTUALS_MODEL||'',format:'evidence-json'});
  const operator=new GrokOperator(args[1]);
  try{return await runResearchTask({task:args[0],status:operator.status(),explain});}finally{operator.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  main(process.argv.slice(2)).then(r=>{process.stdout.write(JSON.stringify(r,null,2)+'\n');if(r.failed)process.exitCode=1;}).catch(()=>{process.stderr.write('Research task unavailable. Check task, simulation ledger and private configuration.\n');process.exitCode=1;});
}
