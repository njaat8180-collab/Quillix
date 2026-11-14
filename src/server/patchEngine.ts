import * as diff from 'diff';
import { FilePatch } from '../shared/types.js';

export class PatchEngine {
  /**
   * Generates a unified diff string and FilePatch metadata between two text versions
   */
  static createPatch(filePath: string, oldContent: string, newContent: string, changeType?: 'created' | 'modified' | 'deleted'): FilePatch {
    const type = changeType || (oldContent === '' ? 'created' : newContent === '' ? 'deleted' : 'modified');
    const patchStr = diff.createTwoFilesPatch(
      `a/${filePath}`,
      `b/${filePath}`,
      oldContent,
      newContent,
      'original',
      'modified',
      { context: 3 }
    );

    const changes = diff.diffLines(oldContent, newContent);
    let linesAdded = 0;
    let linesRemoved = 0;

    for (const part of changes) {
      if (part.added) {
        linesAdded += part.count || 0;
      } else if (part.removed) {
        linesRemoved += part.count || 0;
      }
    }

    return {
      filePath,
      changeType: type,
      oldContent,
      newContent,
      diff: patchStr,
      linesAdded,
      linesRemoved,
      applied: false,
    };
  }

  /**
   * Validates if the patch is applicable to current content.
   * If current content matches oldContent, it applies directly.
   * If current content differs slightly, it attempts 3-way fuzzy apply using diff.applyPatch.
   */
  static applyPatch(currentContent: string, patch: FilePatch): { success: boolean; result?: string; error?: string } {
    if (patch.changeType === 'created') {
      if (currentContent !== '' && currentContent !== patch.newContent) {
        return { success: false, error: `Cannot create ${patch.filePath}: existing content would be overwritten. Refresh the file and regenerate the patch.` };
      }
      return { success: true, result: patch.newContent || '' };
    }

    if (patch.changeType === 'deleted') {
      if (patch.oldContent === undefined || currentContent !== patch.oldContent) {
        return { success: false, error: `Cannot delete ${patch.filePath}: content changed since review. Refresh the file and regenerate the patch.` };
      }
      return { success: true, result: '' };
    }

    // Exact match fast path
    if (patch.oldContent !== undefined && currentContent === patch.oldContent) {
      return { success: true, result: patch.newContent || '' };
    }

    // Use diff.applyPatch to apply the patch onto currentContent
    const patched = diff.applyPatch(currentContent, patch.diff);
    if (patched === false) {
      return {
        success: false,
        error: `Patch cannot be cleanly applied to ${patch.filePath} because the file was modified since the patch was created.`,
      };
    }

    return { success: true, result: patched };
  }

  /**
   * Parses unified diff into human-readable lines with status: 'add', 'remove', 'context'
   */
  static parseDiffLines(diffText: string): Array<{ type: 'add' | 'remove' | 'context' | 'header'; text: string; oldLine?: number; newLine?: number }> {
    const lines = diffText.split('\n');
    const result: Array<{ type: 'add' | 'remove' | 'context' | 'header'; text: string; oldLine?: number; newLine?: number }> = [];

    let currentOld = 0;
    let currentNew = 0;

    for (const line of lines) {
      if (line.startsWith('@@')) {
        const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
        if (match) {
          currentOld = parseInt(match[1], 10);
          currentNew = parseInt(match[2], 10);
        }
        result.push({ type: 'header', text: line });
      } else if (line.startsWith('---') || line.startsWith('+++') || line.startsWith('Index:')) {
        result.push({ type: 'header', text: line });
      } else if (line.startsWith('+')) {
        result.push({ type: 'add', text: line.substring(1), newLine: currentNew++ });
      } else if (line.startsWith('-')) {
        result.push({ type: 'remove', text: line.substring(1), oldLine: currentOld++ });
      } else if (line.startsWith(' ')) {
        result.push({ type: 'context', text: line.substring(1), oldLine: currentOld++, newLine: currentNew++ });
      }
    }

    return result;
  }
}
