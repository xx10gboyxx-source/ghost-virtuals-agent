import {GrokOperator} from '../operator.mjs';
import {createVirtualsExplainer,report} from './reporter.mjs';

async function main() {
  const args=process.argv.slice(2);
  if(args.length>1) throw new Error('Use npm run report -- /path/to/simulation.sqlite');
  const operator = new GrokOperator(args[0] || './state/ghost-grok.sqlite');
  try {
    const explain=createVirtualsExplainer({
      enabled:process.env.GHOST_ENABLE_INFERENCE==='true',
      apiKey:process.env.VIRTUALS_API_KEY || '', model:process.env.VIRTUALS_MODEL || '',
    });
    process.stdout.write(JSON.stringify(await report(operator.status(),{explain}),null,2)+'\n');
  } finally { operator.close(); }
}
main().catch(()=>{process.stderr.write('Report unavailable. Check local configuration; no private provider error is printed.\n');process.exitCode=1;});
