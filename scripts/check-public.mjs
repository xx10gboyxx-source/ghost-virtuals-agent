import {readdirSync,readFileSync,lstatSync} from 'node:fs';
import {resolve,relative,join} from 'node:path';
const root=resolve(import.meta.dirname,'..');
const failures=[];
function walk(dir){
  for(const name of readdirSync(dir)){
    if(['.git','node_modules'].includes(name))continue;
    const path=join(dir,name),rel=relative(root,path),stat=lstatSync(path);
    if(stat.isSymbolicLink()){failures.push(`${rel}: symbolic link`);continue;}
    if(stat.isDirectory()){walk(path);continue;}
    if(/(^|\/)\.env($|\.)/.test(rel)&&rel!=='.env.example'||/\.(sqlite|db|pem|key|p12|keystore|log)(-|$)/.test(rel)||rel.startsWith('state/'))failures.push(`${rel}: private runtime file`);
    const text=readFileSync(path,'utf8');
    const patterns=[/-----BEGIN [A-Z ]*PRIVATE KEY-----/,/\bgh[pousr]_[A-Za-z0-9]{25,}\b/,/\bgithub_pat_[A-Za-z0-9_]{30,}\b/,/\bsk-(?:proj-)?[A-Za-z0-9_-]{30,}\b/,/\b[A-Za-z0-9._%+-]+@(?:gmail|outlook|yahoo)\.com\b/];
    if(patterns.some(pattern=>pattern.test(text)))failures.push(`${rel}: possible private content`);
  }
}
walk(root);
if(failures.length){for(const failure of failures)console.error(failure);process.exitCode=1;}
else console.log('Public-content checks passed: no forbidden runtime files or matched credential patterns. This is not a comprehensive secret audit.');
