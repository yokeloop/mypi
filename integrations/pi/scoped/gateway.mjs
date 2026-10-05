// Trusted host component. Never mount this process's agent/auth directory into a worker.
import fs from 'node:fs';
import net from 'node:net';
import { once } from 'node:events';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { getCurrentTools } from '@earendil-works/pi-ai/compat';

const rawCommand = "node -e \"const net=require('node:net');let b='',seen=0;const s=net.connect('/bridge/mypi.sock');s.setTimeout(1500,()=>{process.exitCode=2;s.destroy()});s.on('error',()=>{process.exitCode=3});s.on('connect',()=>{for(const [id,method,params] of [[1,'tools/call',{name:'request_show',arguments:{}}],[2,'tools/call',{name:'request_show',arguments:{key:'FOREIGN-1'}}],[3,'tools/call',{name:'request_status',arguments:{status:'done',approved:true}}],[4,'resources/read',{uri:'file:///etc/passwd'}]])s.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\\\\n')});s.on('data',chunk=>{b+=chunk;let at;while((at=b.indexOf('\\\\n'))>=0){const r=JSON.parse(b.slice(0,at));b=b.slice(at+1);if(r.id===1?r.result?.isError!==false:r.result?.isError!==true)process.exitCode=4;if(++seen===4)s.end()}});\"";

export default async function(pi) {
  const config = JSON.parse(fs.readFileSync(process.env.MYPI_GATEWAY_CONFIG, 'utf8'));
  const runtime = await ModelRuntime.create({ authPath: config.fixture ? config.emptyAuth : config.authPath, modelsPath: config.emptyModels });
  fs.writeFileSync(config.ready + '.api', JSON.stringify({ getModel: typeof runtime.getModel, streamSimple: typeof runtime.streamSimple }));
  const model = config.fixture ? {
    id: 'scope-probe', provider: 'mypi-fixture', api: 'mypi-fixture', name: 'Offline scope fixture (not an LLM)',
    reasoning: false, input: ['text'], contextWindow: 64000, maxTokens: 2048,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  } : runtime.getModel(config.provider, config.model);
  if (!model || (!config.fixture && typeof runtime.streamSimple !== 'function')) throw new Error('Configured provider adapter unavailable');
  // Public model metadata only; never API keys, headers, base URLs or provider environment.
  fs.writeFileSync(config.metadata, JSON.stringify({ provider: model.provider, id: model.id, name: model.name,
    reasoning: model.reasoning, input: model.input, contextWindow: model.contextWindow, maxTokens: model.maxTokens, cost: model.cost }));
  let busy = false, calls = 0;
  const controllers = new Set();
  async function granted() {
    await new Promise((resolve, reject) => {
      const s = net.connect(config.grantSocket); let data = '';
      s.setTimeout(2000, () => s.destroy(new Error('Grant deadline')));
      s.on('error', reject); s.on('connect', () => s.write('{"jsonrpc":"2.0","id":1,"method":"mypi/check"}\n'));
      s.on('data', chunk => { data += chunk; if (data.includes('\n')) { s.end(); const r = JSON.parse(data.split('\n')[0]); r.result?.isError || r.error ? reject(new Error('Revoked')) : resolve(); } });
    });
  }
  async function send(socket, event, signal) {
    if (!socket.write(JSON.stringify(event) + '\n')) await once(socket, 'drain', { signal });
  }
  const server = net.createServer(socket => {
    if (busy) { socket.destroy(); return; }
    busy = true; let buffer = '', started = false;
    const controller = new AbortController(); controllers.add(controller);
    socket.setTimeout(120000, () => socket.destroy());
    socket.on('error', () => {});
    socket.on('close', () => { controller.abort(); controllers.delete(controller); if (!started) busy = false; });
    socket.on('data', chunk => {
      if (started) { socket.destroy(); return; }
      buffer += chunk;
      if (Buffer.byteLength(buffer) > 8 * 1024 * 1024) { socket.destroy(); return; }
      if (!buffer.includes('\n')) return;
      started = true;
      void (async () => {
        try {
          if (++calls > config.maxCalls) throw new Error('Model call budget exhausted');
          const request = JSON.parse(buffer.trim());
          if (Object.keys(request).some(k => k !== 'context') || !Array.isArray(request.context?.messages)) throw new Error('Invalid model request');
          await granted();
          if (config.fixture) {
            const script = `await tools.write({path:'/work/mp5-proof.txt',content:'scoped tools work'});\n` +
              `await tools.edit({path:'/work/mp5-proof.txt',edits:[{oldText:'scoped tools work',newText:'scoped tools work (edited)'}]});\n` +
              `if(!(await tools.read({path:'/work/mp5-proof.txt'})).includes('(edited)'))throw Error('read/edit');\n` +
              `const git=await tools.bash({command:"git add -- mp5-proof.txt && git -c commit.gpgSign=false commit --allow-empty -qm 'Fixture private commit' && git rev-parse HEAD",timeout:5}); if(git.exit_code!==0)throw Error('private Git');\n` +
              `const raw=await tools.bash({command:${JSON.stringify(rawCommand)},timeout:5});if(raw.exit_code!==0)throw Error('raw broker scope');\n` +
              `const own=await tools.mcp__mypi__request_show({}); if(own.isError)throw Error('own scope failed');\n` +
              `const progress=await tools.mcp__mypi__request_progress({text:'Offline fixture: scoped tools and private Git exercised.'}); if(progress.isError)throw Error('progress');\n` +
              `let foreignDenied=false;try{foreignDenied=(await tools.mcp__mypi__request_show({key:'FOREIGN-1'})).isError;}catch{foreignDenied=true;}if(!foreignDenied)throw Error('foreign task');\n` +
              `for(const path of ['/etc/passwd','/proc/1/root/etc/passwd']){let denied=false;try{await tools.read({path});}catch{denied=true;}if(!denied)throw Error('escape');}\n` +
              (config.derive ? `const read=await tools.mcp__mypi__derive_read({format:'html'});if(read.isError)throw Error('derive read');\n` +
                `let deriveDenied=false;try{deriveDenied=(await tools.mcp__mypi__derive_read({short_id:'foreign1'})).isError;}catch{deriveDenied=true;}if(!deriveDenied)throw Error('derive foreign');\n` +
                `const pub=await tools.mcp__mypi__derive_publish({base_version:1,edits:[{old_str:'fixture',new_str:'fixture-ok'}]});if(pub.isError)throw Error('derive publish');\n` : '') +
              `await tools.bash({command:${JSON.stringify("setsid /usr/bin/bash -c 'exec -a mypi-task-canary-" + config.attempt + " /usr/bin/sleep 300' </dev/null >/dev/null 2>&1 &")},timeout:5});\n` +
              `text({fixture:'MP5_PRODUCT_PIPELINE_OK'});`;
            fs.writeFileSync(config.ready + '.history', JSON.stringify({ restoredPipelineResults: request.context.messages.filter(m => m.role === 'assistant' && m.content?.some?.(c => c.type === 'text' && c.text.includes('offline fixture, not an LLM'))).length }));
            const last = request.context.messages.at(-1);
            const useTool = last?.role !== 'toolResult';
            if (!useTool && (last.isError || last.toolName !== 'codemode' || !JSON.stringify(last.content).includes('MP5_PRODUCT_PIPELINE_OK'))) throw new Error('Offline tool assertion failed');
            if (useTool && !getCurrentTools(request.context.messages).some(t => t.name === 'codemode')) throw new Error('No codemode');
            const content = useTool ? [{ type: 'toolCall', id: 'scope-proof', name: 'codemode', arguments: { code: script } }] : [{ type: 'text', text: 'MP5_OK_' + config.attempt + ' — offline fixture, not an LLM' }];
            const message = { role: 'assistant', content, api: model.api, provider: model.provider, model: model.id,
              usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
              stopReason: useTool ? 'toolUse' : 'stop', timestamp: Date.now() };
            await send(socket, { type: 'start', partial: message }, controller.signal);
            if (useTool) {
              await send(socket, { type: 'toolcall_start', contentIndex: 0, partial: message }, controller.signal);
              await send(socket, { type: 'toolcall_end', contentIndex: 0, toolCall: content[0], partial: message }, controller.signal);
            } else {
              await send(socket, { type: 'text_start', contentIndex: 0, partial: message }, controller.signal);
              await send(socket, { type: 'text_delta', contentIndex: 0, delta: content[0].text, partial: message }, controller.signal);
              await send(socket, { type: 'text_end', contentIndex: 0, content: content[0].text, partial: message }, controller.signal);
            }
            await send(socket, { type: 'done', reason: message.stopReason, message }, controller.signal);
          } else {
            // Model and options are host-selected. No worker URLs, headers, API keys or provider IDs.
            for await (const event of runtime.streamSimple(model, request.context, { signal: controller.signal, maxTokens: Math.min(model.maxTokens, 8192) })) {
              await granted();
              if (event.type === 'error' && event.error) event.error.errorMessage = 'Provider failed; inspect trusted provider diagnostics';
              await send(socket, event, controller.signal);
            }
          }
          socket.end();
        } catch { socket.destroy(); } finally { busy = false; }
      })();
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(config.socket, resolve); });
  fs.chmodSync(config.socket, 0o600);
  fs.writeFileSync(config.ready + '.tmp', JSON.stringify({ pid: process.pid }));
  fs.renameSync(config.ready + '.tmp', config.ready);
  const stop = () => { for (const c of controllers) c.abort(); server.close(); };
  pi.on('session_shutdown', stop);
  pi.on('before_agent_start', () => { throw new Error('Host gateway never runs an agent turn'); });
}
