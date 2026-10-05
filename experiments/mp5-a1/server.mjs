import net from 'node:net';
import fs from 'node:fs';
let own = 'own-canary';
const allowed = 'MP-5'; // Bound to this listener; never taken from a client-supplied grant.
const ok = value => ({content:[{type:'text',text:JSON.stringify(value)}],structuredContent:value,isError:false});
const denied = () => ({content:[{type:'text',text:'scope denied'}],isError:true});
const server=net.createServer(socket=>{
  let pending='';
  socket.on('error',()=>{});
  socket.on('data',chunk=>{
    pending+=chunk;
    if(pending.length>65536){socket.destroy();return;}
    for(let i;(i=pending.indexOf('\n'))>=0;){
      const line=pending.slice(0,i);pending=pending.slice(i+1);
      let req;try{req=JSON.parse(line);}catch{socket.destroy();return;}
      fs.appendFileSync('/private/api-log.jsonl',JSON.stringify({method:req.method,params:req.params??null})+'\n');
      if(req.id===undefined)continue;
      let result,error;
      if(req.method==='initialize')result={protocolVersion:'2024-11-05',capabilities:{tools:{},resources:{}},serverInfo:{name:'mp5-fixture',version:'0.0.1'}};
      else if(req.method==='tools/list')result={tools:['read_record','write_record'].map(name=>({name,description:'Disposable scoped fixture',inputSchema:{type:'object',properties:{request:{type:'string'},value:{type:'string'}},required:['request'],additionalProperties:false}}))};
      else if(req.method==='resources/list')result={resources:[{uri:'fixture://MP-5',name:'own fixture',mimeType:'text/plain'}]};
      else if(req.method==='resources/templates/list')result={resourceTemplates:[]};
      else if(req.method==='resources/read'){
        if(req.params?.uri==='fixture://MP-5')result={contents:[{uri:'fixture://MP-5',text:own}]};
        else error={code:-32003,message:'scope denied'};
      } else if(req.method==='tools/call'){
        const {name,arguments:a}=req.params??{};
        if(a?.request!==allowed)result=denied();
        else if(name==='read_record')result=ok({value:own});
        else if(name==='write_record' && typeof a.value==='string' && a.value.length<1000){own=a.value;result=ok({saved:true});}
        else result=denied();
      } else if(req.method==='ping')result={};
      else error={code:-32601,message:'method not allowed'};
      socket.write(JSON.stringify({jsonrpc:'2.0',id:req.id,...(error?{error}:{result})})+'\n');
    }
  });
});
server.listen('/bridge/api.sock',()=>fs.writeFileSync('/bridge/ready','ready'));
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
