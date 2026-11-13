export interface EditorProjectFile { filePath: string; content: string }
export interface EditorProjectSnapshot {
  root: string;
  files: EditorProjectFile[];
  limited: boolean;
  scannedEntries: number;
  readBytes: number;
}
