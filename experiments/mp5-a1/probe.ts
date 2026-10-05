import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { createReadTool, createWriteTool, createEditTool, createBashTool } from '@earendil-works/pi-coding-agent';
import { truncateToWidth } from '@earendil-works/pi-tui';

// Disposable experiment only. No provider requests and no production credentials.
export default function (pi: any) {
  const results: any[] = [];
  let restoredEntries = 0;
  const renderWidths:number[]=[];
  const recordSize=()=>fs.appendFileSync('/work/resize.jsonl',JSON.stringify({columns:process.stdout.columns,rows:process.stdout.rows,at:Date.now()})+'\n');
  const recordWinch=()=>fs.appendFileSync('/work/sigwinch.jsonl',JSON.stringify({at:Date.now()})+'\n');
  const ttySize=():Promise<{rows:number;columns:number}>=>new Promise((resolve,reject)=>{
    const child=spawn('/usr/bin/stty',['size'],{stdio:['inherit','pipe','pipe'],signal:AbortSignal.timeout(2000)});
    let output='';
    child.stdout!.on('data',chunk=>{output+=chunk;});
    child.once('error',reject);
    child.once('close',code=>{
      const match=/^(\d+)\s+(\d+)\s*$/.exec(output);
      if(code!==0 || !match){reject(new Error('stty size failed: '+output));return;}
      resolve({rows:Number(match[1]),columns:Number(match[2])});
    });
  });
  const armChild=async()=>{
    const child=spawn('/usr/bin/sleep',['120'],{stdio:'ignore',argv0:'mp5-a1-cleanup-canary'});
    await new Promise<void>((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
    fs.writeFileSync('/work/child-cleanup.json',JSON.stringify({pid:child.pid,command:'mp5-a1-cleanup-canary 120',purpose:'Bounded cgroup cleanup canary'}));
    child.unref();
  };
  const out = (name: string, data: unknown) => {
    results.push({name, data});
    fs.writeFileSync('/work/probe.json', JSON.stringify(results, null, 2));
  };
  const call = (request: unknown): Promise<any> => new Promise((resolve, reject) => {
    const socket = net.connect('/bridge/api.sock');
    let body = '';
    socket.setTimeout(3000, () => socket.destroy(new Error('fixture API deadline')));
    socket.on('connect', () => socket.write(JSON.stringify(request) + '\n'));
    socket.on('error', reject);
    socket.on('data', chunk => {
      body += chunk;
      if (body.includes('\n')) { socket.end(); resolve(JSON.parse(body.split('\n')[0])); }
    });
  });
  pi.on('before_agent_start', (_event:unknown,ctx:any) => {
    if(ctx.model?.provider !== 'mp5-fixture')throw new Error('MODEL_CALLS_FORBIDDEN_IN_MP5_EXPERIMENT');
  });
  pi.on('session_start', (_event: unknown, ctx: any) => {
    process.stdout.on('resize',recordSize);
    process.on('SIGWINCH',recordWinch);
    recordSize();
    if(ctx.mode==='tui')ctx.ui.setFooter(()=>({
      invalidate(){},
      render(width:number){
        if(renderWidths.at(-1)!==width){
          renderWidths.push(width);
          fs.writeFileSync('/work/render-widths.json',JSON.stringify(renderWidths));
        }
        return [truncateToWidth('MP5 fixture renderer width='+width,width)];
      },
    }));
    restoredEntries = ctx.sessionManager.getBranch().filter((entry:any) => entry.customType === 'mp5-prototype-evidence').length;
    fs.writeFileSync('/work/ready.json', JSON.stringify({
      restoredEntries,
      restoredPipelineResults:ctx.sessionManager.getBranch().filter((entry:any)=>entry.type==='message' && entry.message?.role==='toolResult' && entry.message?.toolName==='codemode' && JSON.stringify(entry.message.content).includes('MP5_PIPELINE_OK')).length,
      sessionId: ctx.sessionManager.getSessionId(), sessionFile: ctx.sessionManager.getSessionFile(), cwd: ctx.cwd,
      stdinTTY: process.stdin.isTTY, stdoutTTY: process.stdout.isTTY,
      ttyDevice:fs.fstatSync(0).rdev,
      procStat:fs.readFileSync('/proc/self/stat','utf8'),
      executeToolOnCommandContext: typeof ctx.executeTool,
      visibleTools: pi.getAllTools().map((t: any) => t.name),
    }, null, 2));
    ctx.ui.notify('MP5_A1_READY: use /mp5-probe then /mp5-finish', 'info');
  });
  pi.on('session_shutdown',()=>{
    process.stdout.off('resize',recordSize);
    process.off('SIGWINCH',recordWinch);
  });
  pi.registerCommand('mp5-size',{
    description:'Measure actual PTY size and the width supplied to Pi rendering',
    handler:async (phase:string,ctx:any)=>{
      assert.ok(['initial','split','restored'].includes(phase),'Unknown size phase');
      const tty=await ttySize();
      const sample={phase,tty,renderWidth:renderWidths.at(-1),stdoutColumns:process.stdout.columns};
      fs.writeFileSync('/work/size-'+phase+'.json',JSON.stringify(sample,null,2));
      assert.equal(sample.renderWidth,tty.columns,'Pi renderer must match PTY width');
      if(phase==='split'){
        const initial=JSON.parse(fs.readFileSync('/work/size-initial.json','utf8'));
        assert.ok(tty.columns<initial.tty.columns,'Split must reduce terminal width');
      }
      if(phase==='restored'){
        const initial=JSON.parse(fs.readFileSync('/work/size-initial.json','utf8'));
        assert.deepEqual(tty,initial.tty,'Closing split must restore terminal dimensions');
      }
      ctx.ui.notify('MP5_SIZE_'+phase.toUpperCase()+'_PASS','info');
    },
  });
  pi.registerCommand('mp5-probe', {
    description: 'Run bounded fixture checks without calling a model',
    handler: async (_args: string, ctx: any) => {
      try {
        const read = createReadTool('/work');
        const write = createWriteTool('/work');
        const edit = createEditTool('/work');
        const bash = createBashTool('/work');
        const signal = AbortSignal.timeout(10000);
        // Native tool implementations, called directly: NOT evidence for the full model tool pipeline.
        await write.execute('p-write', {path:'/work/tool.txt',content:'before\n'}, signal);
        await edit.execute('p-edit', {path:'/work/tool.txt',edits:[{oldText:'before',newText:'after'}]}, signal);
        const text = await read.execute('p-read', {path:'/work/tool.txt'}, signal);
        assert.match(JSON.stringify(text), /after/);
        out('native-read-write-edit', 'pass');
        await bash.execute('p-bash', {command:"printf 'shell-ok\\n' > /work/shell.txt",timeout:3}, signal);
        assert.equal(fs.readFileSync('/work/shell.txt','utf8'), 'shell-ok\n');
        out('native-bash', 'pass');
        await assert.rejects(() => read.execute('deny-read',{path:'/work/foreign-link'},signal));
        await assert.rejects(() => write.execute('deny-write',{path:'/context/read-only.txt',content:'bad'},signal));
        const denied = await bash.execute('deny-shell', {
          command:"test ! -e /private/foreign.txt && test ! -e /home/priney && ! printf bad > /context/read-only.txt",timeout:3
        }, signal);
        assert.ok(!denied.isError);
        assert.equal(fs.readFileSync('/context/read-only.txt','utf8'),'context-canary\n');
        out('foreign-read-symlink-and-readonly-write', 'pass');
        const request=(id:number,name:string,args:any)=>({jsonrpc:'2.0',id,method:'tools/call',params:{name,arguments:args}});
        // Initialize this case independently from earlier pipeline writes.
        assert.equal((await call(request(0,'write_record',{request:'MP-5',value:'own-canary'}))).result.isError,false);
        assert.equal((await call(request(1,'read_record',{request:'MP-5'}))).result.structuredContent.value,'own-canary');
        assert.equal((await call(request(2,'read_record',{request:'MP-OTHER'}))).result.isError,true);
        assert.equal((await call(request(3,'write_record',{request:'MP-5',value:'changed'}))).result.isError,false);
        assert.equal((await call(request(4,'read_record',{request:'MP-5'}))).result.structuredContent.value,'changed');
        assert.equal((await call(request(5,'write_record',{request:'MP-OTHER',value:'bad'}))).result.isError,true);
        assert.equal((await call({jsonrpc:'2.0',id:6,method:'resources/read',params:{uri:'fixture://MP-OTHER'}})).error.code,-32003);
        assert.equal((await call(request(7,'mint_workspace_token',{}))).result.isError,true);
        out('fixture-scoped-api-positive-negative', 'pass');
        out('tool-registration', pi.getAllTools().map((t:any)=>t.name));
        out('session',ctx.sessionManager.getSessionId());
        out('restored-entries',restoredEntries);
        pi.appendEntry('mp5-prototype-evidence',{checks:results.length});
        pi.sendMessage({customType:'mp5-fixture-note',content:'Offline fixture checks only. No model request was made.',display:true});
        ctx.ui.notify('MP5_A1_PROBE_PASS', 'info');
      } catch(error) {
        out('failure',String(error));
        ctx.ui.notify('MP5_A1_PROBE_FAIL '+String(error),'error');
      }
    },
  });
  pi.registerCommand('mp5-arm-child', {
    description:'Start a disposable cgroup-cleanup canary before keyboard exit',
    handler:async (_args:string,ctx:any)=>{await armChild();ctx.ui.notify('MP5_CHILD_ARMED','info');},
  });
  pi.registerCommand('mp5-finish', {
    description:'Stop this disposable Pi session without making a model request',
    handler:async (_args:string,ctx:any)=>{
      await armChild();
      ctx.shutdown();
    },
  });
}
