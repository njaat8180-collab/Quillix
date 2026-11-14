/**
 * QUILLIX Tool Name & Argument Aliases
 * ====================================
 * Small local models name tools and arguments inconsistently — "file_write"
 * instead of "write_file", "path" instead of "filePath". Before a tool call is
 * validated or executed, BOTH the text-parser and the registry normalize
 * through this single table, so the same contract applies everywhere:
 *
 *   {"tool": "file_write", "arguments": {"path": "test.html", "content": "…"}}
 *
 * executes exactly like {"name": "write_file", "arguments": {"filePath": …}}.
 *
 * Unknown tools are NEVER aliased into existence — only well-known synonyms
 * of registered tools map to canonical names; everything else stays rejected.
 */

/** Canonical tool-name synonyms. Keys are lowercase. */
const TOOL_NAME_ALIASES: Record<string, string> = {
  // file writes
  file_write: 'write_file',
  write: 'write_file',
  writefile: 'write_file',
  save_file: 'write_file',
  create: 'create_file',
  new_file: 'create_file',
  // append / edit
  append: 'append_file',
  append_to_file: 'append_file',
  file_append: 'append_file',
  edit: 'edit_file',
  replace_text: 'edit_file',
  file_edit: 'edit_file',
  str_replace: 'edit_file',
  replace_in_file: 'edit_file',
  // reads
  file_read: 'read_file',
  read: 'read_file',
  open_file: 'read_file',
  // directories
  mkdir: 'create_directory',
  make_directory: 'create_directory',
  create_folder: 'create_directory',
  create_dir: 'create_directory',
  // listing / search
  ls: 'list_directory',
  list: 'list_directory',
  list_dir: 'list_directory',
  metadata: 'get_file_metadata',
  file_metadata: 'get_file_metadata',
  stat: 'get_file_metadata',
  file_info: 'get_file_metadata',
  project_structure: 'get_project_structure',
  tree: 'get_project_structure',
  directory_tree: 'get_project_structure',
  structure: 'get_project_structure',
  diff_files: 'compare_files',
  file_diff: 'compare_files',
  verify: 'verify_file',
  check_file: 'verify_file',
  find: 'search_files',
  search: 'search_files',
  // execution
  run: 'run_command',
  execute: 'run_command',
  exec: 'run_command',
  terminal: 'run_command',
  // deletion
  file_delete: 'delete_file',
  delete: 'delete_file',
  remove_file: 'delete_file',
  rm: 'delete_file',
};

/** Argument-key synonyms per canonical tool family. Keys are lowercase. */
const ARG_KEY_ALIASES: Record<string, string> = {
  path: 'filePath',
  file_path: 'filePath',
  filepath: 'filePath',
  filename: 'filePath',
  file: 'filePath',
  target: 'filePath',
  target_path: 'filePath',
  dir: 'dirPath',
  directory: 'dirPath',
  folder: 'dirPath',
  dirpath: 'dirPath',
  directorypath: 'dirPath',
  src: 'sourcePath',
  source: 'sourcePath',
  src_path: 'sourcePath',
  dest: 'destinationPath',
  destination: 'destinationPath',
  dest_path: 'destinationPath',
  dst: 'destinationPath',
  old_path: 'oldPath',
  oldpath: 'oldPath',
  new_path: 'newPath',
  newpath: 'newPath',
  old_string: 'oldString',
  oldstring: 'oldString',
  old_str: 'oldString',
  old_text: 'oldString',
  oldtext: 'oldString',
  find: 'oldString',
  search_text: 'oldString',
  new_string: 'newString',
  newstring: 'newString',
  new_str: 'newString',
  new_text: 'newString',
  newtext: 'newString',
  replacement: 'newString',
  replace_with: 'newString',
};

/** Normalizes a tool name: trim, lowercase, then map well-known synonyms. */
export function normalizeToolName(name: string): string {
  const raw = (name || '').trim();
  if (!raw) return raw;
  const lower = raw.toLowerCase();
  return TOOL_NAME_ALIASES[lower] || raw;
}

/**
 * Normalizes argument keys of a tool call into the registry's canonical
 * names (path → filePath etc.). Values are never touched; unknown keys pass
 * through unchanged so validation reports them honestly.
 */
export function normalizeToolArgs(args: Record<string, any> | undefined | null): Record<string, any> {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return {};
  const out: Record<string, any> = {};
  for (const [key, value] of Object.entries(args)) {
    const mapped = ARG_KEY_ALIASES[key.toLowerCase()] || key;
    if (out[mapped] === undefined) out[mapped] = value;
  }
  return out;
}
