import fs from 'node:fs';
import path from 'node:path';

interface KnowledgeManifestEntry {
  file: string;
  title: string;
  source: string;
  license: string;
  tags: string[];
}

interface KnowledgeManifest {
  version: number;
  documents: KnowledgeManifestEntry[];
}

interface KnowledgeDocument extends KnowledgeManifestEntry {
  content: string;
}

export interface KnowledgeContextReport {
  context: string;
  files: string[];
}

const STOP = new Set('the and with this that please file files project create update refactor fix explain code change implement function class export import from return const let var test tests make build use using into for from have has are was will should can want need'.split(' '));
const terms = (value: string): string[] => [...new Set(
  (value.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().match(/[\p{L}\p{N}_]{3,}/gu) || [])
    .filter(word => !STOP.has(word))
)].slice(0, 32);

function safeManifest(value: unknown): KnowledgeManifest {
  if (!value || typeof value !== 'object') return { version: 1, documents: [] };
  const raw = value as { version?: unknown; documents?: unknown };
  const documents = Array.isArray(raw.documents) ? raw.documents : [];
  return {
    version: typeof raw.version === 'number' ? raw.version : 1,
    documents: documents.filter((entry): entry is KnowledgeManifestEntry => {
      if (!entry || typeof entry !== 'object') return false;
      const item = entry as Partial<KnowledgeManifestEntry>;
      return typeof item.file === 'string' && typeof item.title === 'string' &&
        typeof item.source === 'string' && typeof item.license === 'string' &&
        Array.isArray(item.tags) && item.tags.every(tag => typeof tag === 'string');
    }),
  };
}

function defaultKnowledgeDirectories(): string[] {
  const candidates = [
    process.env.QUILLIX_KNOWLEDGE_DIR,
    path.resolve(process.cwd(), 'knowledge', 'official'),
    typeof __dirname === 'string' ? path.resolve(__dirname, '..', 'knowledge', 'official') : undefined,
    typeof __dirname === 'string' ? path.resolve(__dirname, '..', '..', 'knowledge', 'official') : undefined,
  ];
  return [...new Set(candidates.filter((value): value is string => !!value))];
}

/** Small, local, attribution-aware retrieval layer for bundled coding guidance. */
export class KnowledgeBase {
  private readonly documents: KnowledgeDocument[];

  constructor(directories: string[] = defaultKnowledgeDirectories()) {
    this.documents = [];
    for (const directory of directories) {
      const manifestPath = path.join(directory, 'manifest.json');
      try {
        if (!fs.existsSync(manifestPath)) continue;
        const manifest = safeManifest(JSON.parse(fs.readFileSync(manifestPath, 'utf8')));
        for (const entry of manifest.documents) {
          const filePath = path.resolve(directory, entry.file);
          if (!filePath.startsWith(path.resolve(directory) + path.sep) || !fs.existsSync(filePath)) continue;
          const content = fs.readFileSync(filePath, 'utf8').replace(/\0/g, '').slice(0, 256 * 1024);
          if (!content.trim()) continue;
          this.documents.push({ ...entry, content });
        }
        if (this.documents.length) break;
      } catch {
        // Bundled guidance is optional; project coding remains usable if absent.
      }
    }
  }

  public retrieve(prompt: string, options: { maxChars?: number; maxFiles?: number } = {}): KnowledgeContextReport {
    const maxChars = Math.max(0, Math.min(6000, options.maxChars ?? 2400));
    const maxFiles = Math.max(1, Math.min(3, options.maxFiles ?? 2));
    if (!maxChars || !this.documents.length) return { context: '', files: [] };
    const query = terms(prompt);
    if (!query.length) return { context: '', files: [] };
    const ranked = this.documents.map(document => {
      const tagScore = query.reduce((score, word) => score + (document.tags.some(tag => tag === word) ? 18 : 0), 0);
      const contentLower = document.content.toLowerCase();
      const contentScore = query.reduce((score, word) => score + (contentLower.includes(word) ? 2 : 0), 0);
      return { document, score: tagScore + contentScore };
    }).filter(item => item.score > 0).sort((a, b) => b.score - a.score || a.document.file.localeCompare(b.document.file));
    if (!ranked.length) return { context: '', files: [] };

    let context = 'Relevant official coding guidance (reference only; verify against the project and current package versions):\n';
    const files: string[] = [];
    const selected = ranked.slice(0, maxFiles);
    for (let index = 0; index < selected.length; index++) {
      const { document } = selected[index];
      const room = maxChars - context.length;
      if (room < 180) break;
      const lines = document.content.split('\n');
      let bestLine = 0;
      let bestScore = 0;
      for (let index = 0; index < lines.length; index++) {
        const lineScore = query.reduce((score, word) => score + (lines[index].toLowerCase().includes(word) ? 1 : 0), 0);
        if (lineScore > bestScore) { bestLine = index; bestScore = lineScore; }
      }
      const first = Math.max(0, bestLine - 5);
      const last = Math.min(lines.length, first + 34);
      const header = `\nSOURCE ${document.title} (${document.file}), lines ${first + 1}-${last}:\n`;
      const body = lines.slice(first, last).join('\n');
      const remainingDocuments = selected.length - index;
      const allowance = Math.max(0, Math.floor((room - header.length - 80) / remainingDocuments));
      if (allowance < 80) break;
      context += `${header}${body.slice(0, allowance)}\nAttribution: ${document.source} | ${document.license}\n`;
      files.push(document.file);
    }
    return { context: context.slice(0, maxChars), files };
  }
}

let bundledKnowledgeBase: KnowledgeBase | undefined;

/** Reuse the bundled pack across requests; custom directories remain isolated for tests/tools. */
export function getBundledKnowledgeBase(): KnowledgeBase {
  bundledKnowledgeBase ??= new KnowledgeBase();
  return bundledKnowledgeBase;
}
