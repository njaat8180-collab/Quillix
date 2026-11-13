import type {ToolDefinition} from '../shared/types.js';
import { MCP_STDIO_PROTOCOL_VERSION, StdioMcpClient } from './mcpStdio.js';
import { LspStdioClient } from './lspStdio.js';
export type ExtensionTool={definition:ToolDefinition;invoke:(args:Record<string,unknown>)=>Promise<string>};
/** Plugins and MCP share the same provider-independent execution contract. */
export class ExtensionTools {
  private entries=new Map<string,ExtensionTool>();
  private stdioClients=new Map<string,StdioMcpClient>();
  private lspClients=new Map<string,LspStdioClient>();
  register(tool:ExtensionTool) {
    if(!/^(mcp|plugin)_[\w]+$/.test(tool.definition.name)||this.entries.has(tool.definition.name)) throw new Error('Invalid or duplicate extension tool name.');
    this.entries.set(tool.definition.name,tool);
  }
  definitions(){return [...this.entries.values()].map(t=>t.definition);}
  get(name:string){return this.entries.get(name);}
  private removeOwned(prefix: string) {
    for (const name of this.entries.keys()) if (name.startsWith(prefix)) this.entries.delete(name);
  }
  /** Dispose local LSP processes and remove tools bound to the old root. */
  closeLSP() {
    for (const [id, client] of this.lspClients) { client.close(); this.removeOwned(`plugin_lsp_${id}_`); }
    this.lspClients.clear();
  }
  closeAll(){for(const [id, client] of this.stdioClients){client.close();this.removeOwned(`mcp_${id}_`);}this.stdioClients.clear();this.closeLSP();}
  /** HTTP plugin contract: POST {tool, arguments}, return a JSON result. */
  connectPlugin(id:string,endpoint:string,definitions:ToolDefinition[],credential?:()=>string) {
    const url=new URL(endpoint);
    if(!/^\w{1,40}$/.test(id)||url.username||url.password||url.search||url.hash||!(url.protocol==='https:'||(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))) throw new Error('Invalid plugin endpoint or ID.');
    if(!Array.isArray(definitions)||definitions.length>100) throw new Error('Invalid plugin tools.');
    const entries=definitions.map(definition=>{
      if(!/^\w{1,64}$/.test(definition.name)||definition.parameters?.type!=='object') throw new Error('Invalid plugin tool schema.');
      const originalName=definition.name,name=`plugin_${id}_${originalName}`;
      if(this.entries.has(name)) throw new Error('Plugin already registered.');
      return {definition:{...definition,name,permission:'network' as const,category:'project' as const},invoke:async(args:Record<string,unknown>)=>{
        const key=credential?.();
        const response=await fetch(endpoint,{method:'POST',redirect:'error',signal:AbortSignal.timeout(30000),headers:{'Content-Type':'application/json',...(key?{Authorization:`Bearer ${key}`}:{})},body:JSON.stringify({tool:originalName,arguments:args})});
        if(!response.ok) throw new Error(`Plugin HTTP ${response.status}`);return JSON.stringify(await response.json());
      }};
    });
    if(new Set(entries.map(e=>e.definition.name)).size!==entries.length) throw new Error('Duplicate plugin tools.');
    entries.forEach(e=>this.register(e));return this.definitions();
  }
  async connectMCP(id:string,endpoint:string,credential?:()=>string) {
    if(!/^\w{1,40}$/.test(id)) throw new Error('Invalid MCP server ID.');
    const url=new URL(endpoint);
    if(url.username||url.password||url.search||url.hash||!(url.protocol==='https:'||(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))) throw new Error('Use HTTPS or localhost for MCP.');
    let session='';let counter=0;let version='2025-03-26';
    const rpc=async(method:string,params:any,notification=false):Promise<any>=>{
      const requestId=++counter;
      const key=credential?.();
      const response=await fetch(endpoint,{method:'POST',redirect:'error',signal:AbortSignal.timeout(30000),headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream',...(key?{Authorization:`Bearer ${key}`} : {}),...(session?{'Mcp-Session-Id':session}:{}),...(method!=='initialize'?{'MCP-Protocol-Version':version}:{})},body:JSON.stringify({jsonrpc:'2.0',...(!notification?{id:requestId}:{}),method,params})});
      if(!response.ok) throw new Error(`MCP HTTP ${response.status}`);
      session=response.headers.get('mcp-session-id')||session;
      if(notification) {await response.body?.cancel();return;}
      let data:any;
      if(response.headers.get('content-type')?.includes('text/event-stream')) {
        if(!response.body) throw new Error('Missing MCP response.');
        const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';
        try {while(!data) {const {value,done}=await reader.read();buffer+=decoder.decode(value,{stream:!done});const frames=buffer.replace(/\r\n/g,'\n').split('\n\n');buffer=frames.pop()||'';for(const frame of frames) {const payload=frame.split('\n').filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trim()).join('\n');if(payload) {const e=JSON.parse(payload);if(e.id===requestId)data=e;}}if(done)break;}} finally {await reader.cancel();}
      } else data=await response.json();
      if(!data||data.error) throw new Error('MCP request failed.');return data.result;
    };
    const initialized=await rpc('initialize',{protocolVersion:version,capabilities:{},clientInfo:{name:'NUVRO AI',version:'1.2.0'}});
    if(initialized.protocolVersion) {if(!['2024-11-05','2025-03-26','2025-06-18'].includes(initialized.protocolVersion))throw new Error('Unsupported MCP protocol version.');version=initialized.protocolVersion;}
    await rpc('notifications/initialized',{},true);
    const tools:any[]=[];let cursor:string|undefined;
    for(let page=0;page<100;page++) {const result=await rpc('tools/list',cursor?{cursor}:{});if(!Array.isArray(result.tools))throw new Error('Invalid MCP tools list.');tools.push(...result.tools);cursor=result.nextCursor;if(!cursor)break;}
    if(cursor||tools.length>1000) throw new Error('MCP tools list exceeds limits.');
    const names=new Set<string>();
    for(const t of tools) {if(typeof t.name!=='string'||t.inputSchema?.type!=='object')throw new Error('Invalid MCP tool schema.');const name=`mcp_${id}_${t.name.replace(/\W/g,'_')}`;if(names.has(name)||this.entries.has(name))throw new Error('Duplicate MCP tool.');names.add(name);}
    for(const t of tools) {
      const name=`mcp_${id}_${t.name.replace(/\W/g,'_')}`;
      this.register({definition:{name,category:'project',permission:'network',description:t.description||t.name,parameters:t.inputSchema},invoke:async args=>{
        const result=await rpc('tools/call',{name:t.name,arguments:args});
        if(result.isError) throw new Error(JSON.stringify(result.content));return JSON.stringify(result.content);
      }});
    }
    return this.definitions();
  }

  /** Connect a local MCP server over stdio. This is allowed in Offline Mode,
   * unlike HTTP extensions, because no network is involved. The process is
   * spawned without a shell and every tool still travels through NUVRO AI's
   * normal approval path at execution time. */
  async connectMCPStdio(id:string,command:string,args:string[]=[],environment:Record<string,string>={}) {
    if(!/^\w{1,40}$/.test(id)) throw new Error('Invalid MCP server ID.');
    if(this.stdioClients.has(id)) throw new Error('MCP stdio server already connected.');
    const client=new StdioMcpClient(command,args,environment);
    try {
      const initialized=await client.request('initialize',{protocolVersion:MCP_STDIO_PROTOCOL_VERSION,capabilities:{},clientInfo:{name:'NUVRO AI',version:'1.2.0'}});
      const version=typeof initialized?.protocolVersion==='string'?initialized.protocolVersion:MCP_STDIO_PROTOCOL_VERSION;
      if(!['2024-11-05','2025-03-26','2025-06-18'].includes(version)) throw new Error('Unsupported MCP protocol version.');
      client.notify('notifications/initialized',{});
      const tools:any[]=[];let cursor:string|undefined;
      for(let page=0;page<100;page++) {
        const result=await client.request('tools/list',cursor?{cursor}:{});
        if(!Array.isArray(result?.tools)) throw new Error('Invalid MCP tools list.');
        tools.push(...result.tools);cursor=result.nextCursor;
        if(!cursor) break;
      }
      if(cursor||tools.length>1000) throw new Error('MCP tools list exceeds limits.');
      const entries=tools.map(t=>{
        if(!t||typeof t.name!=='string'||!/^\w{1,64}$/.test(t.name)||t.inputSchema?.type!=='object') throw new Error('Invalid MCP tool schema.');
        const originalName=t.name,name=`mcp_${id}_${originalName}`;
        if(this.entries.has(name)) throw new Error('Duplicate MCP tool.');
        return {originalName,name,definition:{name,category:'project' as const,permission:'execute' as const,description:t.description||t.name,parameters:t.inputSchema},invoke:async(args:Record<string,unknown>)=>{
          const result=await client.request('tools/call',{name:originalName,arguments:args});
          if(result?.isError) throw new Error(JSON.stringify(result.content));
          return JSON.stringify(result?.content ?? result);
        }};
      });
      for(const entry of entries) this.register({definition:entry.definition,invoke:entry.invoke});
      this.stdioClients.set(id,client);
      return this.definitions();
    } catch(error) { client.close(); throw error; }
  }

  /** Connect a local language server over stdio and expose bounded, read-only
   * navigation tools. The server is started without a shell and its root is
   * fixed to the active workspace, so LSP results cannot become an arbitrary
   * file-reading escape hatch. */
  async connectLSPStdio(id:string,command:string,args:string[]=[],workspaceRoot:string) {
    if(!/^\w{1,32}$/.test(id)) throw new Error('Invalid LSP server ID.');
    if(this.lspClients.has(id)) throw new Error('LSP stdio server already connected.');
    const client=new LspStdioClient(command,args,workspaceRoot,()=>{
      if (this.lspClients.get(id) === client) {
        this.lspClients.delete(id);
        this.removeOwned(`plugin_lsp_${id}_`);
      }
    });
    const prefix=`plugin_lsp_${id}`;
    const definitions:ToolDefinition[]=[
      {name:`${prefix}_definition`,category:'code',permission:'read',description:`Find the definition at a 1-based file position using the connected local ${id} language server.`,parameters:{type:'object',properties:{filePath:{type:'string',description:'Workspace-relative source file.'},line:{type:'integer',description:'1-based line number.'},column:{type:'integer',description:'1-based column number.'}},required:['filePath','line','column']}},
      {name:`${prefix}_references`,category:'code',permission:'read',description:`Find references at a 1-based file position using the connected local ${id} language server.`,parameters:{type:'object',properties:{filePath:{type:'string',description:'Workspace-relative source file.'},line:{type:'integer',description:'1-based line number.'},column:{type:'integer',description:'1-based column number.'}},required:['filePath','line','column']}},
      {name:`${prefix}_diagnostics`,category:'code',permission:'read',description:`Return diagnostics for a workspace file from the connected local ${id} language server.`,parameters:{type:'object',properties:{filePath:{type:'string',description:'Workspace-relative source file.'}},required:['filePath']}},
      {name:`${prefix}_hover`,category:'code',permission:'read',description:`Read bounded hover/type documentation at a 1-based file position from the connected local ${id} language server.`,parameters:{type:'object',properties:{filePath:{type:'string',description:'Workspace-relative source file.'},line:{type:'integer',description:'1-based line number.'},column:{type:'integer',description:'1-based column number.'}},required:['filePath','line','column']}},
      {name:`${prefix}_completion`,category:'code',permission:'read',description:`Request bounded completion items at a 1-based file position from the connected local ${id} language server.`,parameters:{type:'object',properties:{filePath:{type:'string',description:'Workspace-relative source file.'},line:{type:'integer',description:'1-based line number.'},column:{type:'integer',description:'1-based column number.'}},required:['filePath','line','column']}},
      {name:`${prefix}_rename_preview`,category:'code',permission:'read',description:`Preview a semantic rename at a 1-based file position. Returns workspace edits for review; it never writes files.`,parameters:{type:'object',properties:{filePath:{type:'string',description:'Workspace-relative source file.'},line:{type:'integer',description:'1-based line number.'},column:{type:'integer',description:'1-based column number.'},newName:{type:'string',description:'Proposed replacement identifier.'}},required:['filePath','line','column','newName']}},
      {name:`${prefix}_workspace_symbols`,category:'code',permission:'read',description:`Search semantic symbols across the connected local workspace. Returns bounded locations only.`,parameters:{type:'object',properties:{query:{type:'string',description:'Text or partial symbol name.'}},required:['query']}},
      {name:`${prefix}_document_symbols`,category:'code',permission:'read',description:`Return the semantic outline for one workspace source file.`,parameters:{type:'object',properties:{filePath:{type:'string',description:'Workspace-relative source file.'}},required:['filePath']}},
    ];
    try {
      await client.initialize();
      for(const tool of definitions) {
        const operation=tool.name.endsWith('_definition')?'definition':tool.name.endsWith('_references')?'references':tool.name.endsWith('_diagnostics')?'diagnostics':tool.name.endsWith('_hover')?'hover':tool.name.endsWith('_completion')?'completion':tool.name.endsWith('_rename_preview')?'rename_preview':tool.name.endsWith('_workspace_symbols')?'workspace_symbols':'document_symbols';
        this.register({definition:tool,invoke:async(args:Record<string,unknown>)=>{
          const filePath=typeof args.filePath==='string'?args.filePath:'';
          const result=operation==='definition'
            ? await client.definition(filePath,Number(args.line),Number(args.column))
            : operation==='references'
              ? await client.references(filePath,Number(args.line),Number(args.column))
              : operation==='diagnostics'
                ? await client.diagnostics(filePath)
                : operation==='hover'
                  ? await client.hover(filePath,Number(args.line),Number(args.column))
                  : operation==='completion'
                    ? await client.completion(filePath,Number(args.line),Number(args.column))
                    : operation==='rename_preview'
                      ? await client.renamePreview(filePath,Number(args.line),Number(args.column),typeof args.newName==='string'?args.newName:'')
                      : operation==='workspace_symbols'
                        ? await client.workspaceSymbols(typeof args.query==='string'?args.query:'')
                        : await client.documentSymbols(filePath);
          return JSON.stringify({server:id,filePath,result},null,2);
        }});
      }
      this.lspClients.set(id,client);
      return this.definitions();
    } catch(error) { client.close(); throw error; }
  }
}
