import fs from 'node:fs';
import { createAssistantMessageEventStream, getCurrentTools } from '@earendil-works/pi-ai/compat';

// Deterministic protocol fixture. This is NOT an LLM and performs no network/model calls.
const script = `
const check=(ok,message)=>{if(!ok)throw new Error(message);};
await tools.write({path:'/work/pipeline.txt',content:'before\\n'});
await tools.edit({path:'/work/pipeline.txt',edits:[{oldText:'before',newText:'after'}]});
check(String(await tools.read({path:'/work/pipeline.txt'})).includes('after'),'allowed read/edit');
await tools.bash({command:"printf pipeline-shell > /work/pipeline-shell.txt",timeout:3});
check(String(await tools.read({path:'/work/pipeline-shell.txt'})).includes('pipeline-shell'),'allowed bash');
let blocked=false;
try{await tools.read({path:'/work/foreign-link'});}catch{blocked=true;}
check(blocked,'foreign symlink read must fail');
blocked=false;
try{await tools.write({path:'/context/read-only.txt',content:'bad'});}catch{blocked=true;}
check(blocked,'read-only context write must fail');
const saved=await tools.mcp__scopeprobe__write_record({request:'MP-5',value:'pipeline-own'});
check(saved.isError===false,'own API write');
const own=await tools.mcp__scopeprobe__read_record({request:'MP-5'});
check(own.structuredContent?.value==='pipeline-own','own API read');
const foreign=await tools.mcp__scopeprobe__read_record({request:'MP-OTHER'});
check(foreign.isError===true,'foreign API read');
const wrongWrite=await tools.mcp__scopeprobe__write_record({request:'MP-OTHER',value:'bad'});
check(wrongWrite.isError===true,'foreign API write');
text({fixture:'MP5_PIPELINE_OK',syntheticProvider:true});
`;

export default function(pi:any) {
  let calls=0;
  pi.registerProvider('mp5-fixture', {
    baseUrl:'http://invalid.invalid', apiKey:'non-secret-fixture', api:'mp5-fixture',
    models:[{id:'offline',name:'MP5 deterministic fixture (NOT an LLM)',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:64000,maxTokens:2048}],
    streamSimple(model:any,context:any) {
      const stream=createAssistantMessageEventStream();
      queueMicrotask(()=>{
        try {
          if(++calls>2)throw new Error('Fixture permits only two stream invocations');
          const declared=getCurrentTools(context.messages);
          fs.writeFileSync('/work/provider-tool-schemas.json',JSON.stringify(declared,null,2));
          const last=context.messages.at(-1);
          const needsCall=last?.role!=='toolResult';
          let content:any[];
          if(needsCall) {
            const tool:any=declared.find((tool:any)=>tool.name==='codemode');
            if(!tool)throw new Error('codemode not declared');
            const properties=tool.parameters?.properties;
            if(properties?.code?.type!=='string')throw new Error('Unexpected codemode schema; inspect provider-tool-schemas.json');
            content=[{type:'toolCall',id:'mp5-offline-call',name:'codemode',arguments:{code:script}}];
          } else content=[{type:'text',text:'MP5_FIXTURE_FINISHED — deterministic fixture, no LLM request.'}];
          const message:any={role:'assistant',content,api:model.api,provider:model.provider,model:model.id,
            usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},
            stopReason:needsCall?'toolUse':'stop',timestamp:Date.now()};
          stream.push({type:'start',partial:message});
          if(needsCall){
            stream.push({type:'toolcall_start',contentIndex:0,partial:message});
            stream.push({type:'toolcall_end',contentIndex:0,toolCall:content[0],partial:message});
          } else {
            stream.push({type:'text_start',contentIndex:0,partial:message});
            stream.push({type:'text_delta',contentIndex:0,delta:content[0].text,partial:message});
            stream.push({type:'text_end',contentIndex:0,content:content[0].text,partial:message});
          }
          stream.push({type:'done',reason:message.stopReason,message});
        } catch(error) {
          fs.writeFileSync('/work/provider-error.txt',String(error));
          stream.push({type:'error',reason:'error',error:{role:'assistant',content:[],api:model.api,provider:model.provider,model:model.id,
            usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:'error',errorMessage:String(error),timestamp:Date.now()}});
        }
        stream.end();
      });
      return stream;
    },
  });
  pi.registerCommand('mp5-pipeline', {
    description:'Execute deterministic offline tool-call fixture (no LLM)',
    handler:async (_args:string,ctx:any)=>{
      if(ctx.model?.provider!=='mp5-fixture')throw new Error('Real providers are prohibited');
      pi.sendUserMessage('Run the pre-programmed MP5 offline fixture. No inference is requested.');
    },
  });
  pi.on('agent_end',(event:any,ctx:any)=>{
    const results=event.messages.filter((message:any)=>message.role==='toolResult');
    const pass=results.length===1 && results[0].toolName==='codemode' && !results[0].isError && JSON.stringify(results[0].content).includes('MP5_PIPELINE_OK');
    fs.writeFileSync('/work/pipeline-result.json',JSON.stringify({pass,syntheticProvider:true,results},null,2));
    ctx.ui.notify(pass?'MP5_PIPELINE_PASS':'MP5_PIPELINE_FAIL',pass?'info':'error');
  });
}
