// Optional unprivileged fallback for Ubuntu 24.04 x86_64.
import {spawnSync} from 'node:child_process';
import {mkdir,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
if(process.platform!=='linux'||process.arch!=='x64')throw new Error('This helper supports Ubuntu 24.04 x86_64 only. Use npm run browser:install on other systems.');
const root=resolve(process.env.REWIND_DATA_DIR||'data','browser-libs');
const packages=resolve(root,'packages');
await mkdir(packages,{recursive:true});
function run(command,args){const result=spawnSync(command,args,{cwd:packages,stdio:'inherit'});if(result.error)throw result.error;if(result.status!==0)throw new Error(`${command} failed (${result.status})`);}
run('apt-get',['download','libatk1.0-0t64','libatk-bridge2.0-0t64','libatspi2.0-0t64','libxcomposite1','libxdamage1','libxfixes3','libxrandr2','libxrender1','libxi6','libgbm1','libasound2t64']);
for(const file of await readdir(packages))if(file.endsWith('.deb'))run('dpkg-deb',['-x',resolve(packages,file),root]);
console.log('Browser libraries extracted locally. Next: npx playwright install chromium');
