// Use from a pinned installation in the unprivileged test environment:
// node --test --test-reporter=/trusted/validator/reporters/node-test.js ...
import {spawnSync} from 'node:child_process';
const git = (...args) => {
  const r=spawnSync('git',args,{encoding:'utf8',timeout:10000});
  if(r.status!==0)throw new Error('test reporter could not inspect Git state');
  return r.stdout.trim();
};
export default async function* report(source) {
  const revision=git('rev-parse','HEAD');
  const clean=git('status','--porcelain')==='';
  yield JSON.stringify({type:'wf:context',revision,clean})+'\n';
  let count=0;
  for await (const event of source) {
    if(event.type==='test:pass'||event.type==='test:fail')count++;
    yield JSON.stringify(event)+'\n';
  }
  yield JSON.stringify({type:'wf:complete',revision:git('rev-parse','HEAD'),clean:git('status','--porcelain')==='',count})+'\n';
}
