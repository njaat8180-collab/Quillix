export type BuiltinPlugin = {id:string;name:string;description:string;tools:string[];source:'built-in'};
export const BUILTIN_CODING_PLUGINS: BuiltinPlugin[] = [
  {id:'quillix-chat-router',name:'Chat Response Router',description:'Keeps ordinary provider replies in Chat; only explicit native or structured tool calls can change files.',source:'built-in',tools:['provider_text','native_tool_calls']},
  {id:'quillix-files',name:'File Editor',description:'Read, create, edit, move, delete and patch workspace files with approval gates.',source:'built-in',tools:['read_file','write_file','create_file','edit_file','apply_patch','rename_file','delete_file']},
  {id:'quillix-search',name:'Codebase Explorer',description:'Search files and code, inspect symbols and references, and load project structure.',source:'built-in',tools:['search_files','search_code','find_symbol','find_definition','find_references','get_project_structure']},
  {id:'quillix-terminal',name:'Terminal and Tests',description:'Run commands, builds, tests, linters and project health checks through NUVRO AI approvals.',source:'built-in',tools:['run_command','run_build','run_tests','run_linter','project_health_check']},
  {id:'quillix-git',name:'Git Workspace',description:'Inspect repository state and perform guarded Git operations.',source:'built-in',tools:['git_status','git_diff','git_log','git_branch','git_commit']},
  {id:'quillix-verification',name:'Project Verification',description:'Verify generated files, syntax, references and execution results before reporting completion.',source:'built-in',tools:['verify_file','project_health_check']},
  {id:'quillix-mcp',name:'MCP Tool Bridge',description:'Connect compatible MCP servers and expose their tools to every supported AI provider.',source:'built-in',tools:['mcp_connect','mcp_tools']},
];
