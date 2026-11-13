import { ChatMessage } from './shared/types.js';

export interface StoredChat {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
}

const STORAGE_KEY = 'quillix_chats';

export function loadChats(): StoredChat[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((c) => c && typeof c.id === 'string' && Array.isArray(c.messages));
  } catch {
    return [];
  }
}

function persistChats(chats: StoredChat[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(chats));
  } catch {
    // Storage full or unavailable — keep working in-memory this session.
  }
}

export function saveChat(chat: StoredChat): StoredChat[] {
  const chats = loadChats();
  const index = chats.findIndex((c) => c.id === chat.id);
  if (index >= 0) {
    chats[index] = chat;
  } else {
    chats.unshift(chat);
  }
  persistChats(chats);
  return chats;
}

export function deleteChat(id: string): StoredChat[] {
  const chats = loadChats().filter((c) => c.id !== id);
  persistChats(chats);
  return chats;
}

export function makeChatTitle(firstMessage: string): string {
  const clean = firstMessage.replace(/\s+/g, ' ').trim();
  if (!clean) return 'New chat';
  return clean.length > 48 ? `${clean.slice(0, 48)}…` : clean;
}

export function createChat(firstMessage?: string): StoredChat {
  const now = Date.now();
  return {
    id: `chat_${now}_${Math.random().toString(36).slice(2, 7)}`,
    title: firstMessage ? makeChatTitle(firstMessage) : 'New chat',
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
}
