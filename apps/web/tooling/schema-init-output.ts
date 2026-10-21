import { spawn } from 'node:child_process';

/** Evaluate preloaded zod chunks and their static imports in isolated realms.
 * Count Function attempts even when zod catches the denial during its JIT probe;
 * this is the event that a page's Trusted Types policy reports as a violation. */
export async function assertSchemaInitialization(
  files: ReadonlyMap<string, string>,
): Promise<void> {
  const source = `
    import {SourceTextModule,createContext,runInContext} from 'node:vm';
    import {posix} from 'node:path';
    let input='';for await(const chunk of process.stdin)input+=chunk;
    const files=new Map(JSON.parse(input));
    const html=files.get('index.html')??'';
    const preloads=[...html.matchAll(/rel="modulepreload"[^>]*href="[^"]*\\/(assets\\/[^"]+)"/g)].map(match=>match[1]);
    for(const path of preloads){const text=files.get(path);if(!text||!/jitless/.test(text))continue;
      let attempts=0;
      const context=createContext({console,TextEncoder,TextDecoder,URL,URLSearchParams,setTimeout,clearTimeout,crypto:globalThis.crypto});
      const Original=runInContext('Function',context);
      context.Function=new Proxy(Original,{apply(){attempts++;throw new EvalError('JIT forbidden');},construct(){attempts++;throw new EvalError('JIT forbidden');}});
      const cache=new Map();
      const module=(name)=>{if(cache.has(name))return cache.get(name);const code=files.get(name);if(code===undefined)throw Error('Missing static module '+name);const value=new SourceTextModule(code,{context,identifier:name});cache.set(name,value);return value;};
      const entry=module(path);
      await entry.link((specifier,referrer)=>module(posix.normalize(posix.join(posix.dirname(referrer.identifier),specifier))));
      let failure;try{await entry.evaluate();}catch(error){failure=error;}
      if(attempts)throw Error('SCHEMA_INIT_ORDER '+path+' dynamic-code attempts='+attempts);
      if(failure)throw failure;
    }`;
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--experimental-vm-modules', '--input-type=module', '-e', source],
      { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
    );
    let error = '';
    child.stdout.resume();
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (value: string) => {
      error += value;
    });
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(error)),
    );
    child.stdin.end(JSON.stringify([...files]));
  });
}
