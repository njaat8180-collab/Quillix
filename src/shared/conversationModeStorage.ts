export type ConversationModePreference = 'chat' | 'agent';

/** Parse the server request's top-level safety lock; absent/corrupt values fail closed. */
export function parseConversationMode(value: unknown): ConversationModePreference | null {
  return value === 'chat' || value === 'agent' ? value : null;
}

type ConversationModeStorage = Pick<Storage, 'getItem' | 'setItem'>;
type StorageAccessor = () => ConversationModeStorage;

function normalizeWorkspaceKey(workspaceRoot: string): string {
  const normalized = String(workspaceRoot || '').replace(/\\/g, '/').replace(/\/+$/, '');
  // Windows workspace paths are case-insensitive. Keep POSIX paths case-
  // sensitive so this shared helper behaves correctly in non-Windows tests
  // and any future desktop ports.
  return /^[a-z]:\//i.test(normalized) || normalized.startsWith('//')
    ? normalized.toLowerCase()
    : normalized;
}

export const conversationModeStorageKey = (workspaceRoot: string) =>
  `quillix-conversation-mode:${normalizeWorkspaceKey(workspaceRoot)}`;

/**
 * Read the user's workspace-scoped mode. If browser storage is blocked or
 * unavailable, fail closed to Chat so a persistence error cannot enable edits.
 */
export function readConversationMode(
  workspaceRoot: string,
  getStorage: StorageAccessor,
): ConversationModePreference {
  if (!workspaceRoot) return 'chat';
  try {
    return getStorage().getItem(conversationModeStorageKey(workspaceRoot)) === 'chat' ? 'chat' : 'agent';
  } catch {
    return 'chat';
  }
}

/** Save a selection without making the active session depend on storage. */
export function writeConversationMode(
  workspaceRoot: string,
  mode: ConversationModePreference,
  getStorage: StorageAccessor,
): boolean {
  if (!workspaceRoot) return false;
  try {
    getStorage().setItem(conversationModeStorageKey(workspaceRoot), mode);
    return true;
  } catch {
    return false;
  }
}

/** Accept only preference changes for the active workspace; corrupt/removal events fail closed. */
export function conversationModeFromStorageEvent(
  workspaceRoot: string,
  changedKey: string | null,
  newValue: string | null,
): ConversationModePreference | null {
  if (!workspaceRoot || changedKey !== conversationModeStorageKey(workspaceRoot)) return null;
  return newValue === 'agent' ? 'agent' : 'chat';
}
