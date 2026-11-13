import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiBridge } from '../../services/apiBridge.js';

describe('manual workspace actions honor the conversation mode lock', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('fails closed in Chat mode before file, terminal, tool, project, or preview mutations reach an API', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const bridge = new ApiBridge();
    bridge.setConversationModeContext('D:/workspace', 'chat');

    const results = await Promise.all([
      bridge.writeFile('index.html', '<h1>changed</h1>'),
      bridge.deleteFile('index.html'),
      bridge.renameFile('old.css', 'new.css'),
      bridge.runCommand('npm test'),
      bridge.executeTool('write_file', { filePath: 'index.html', content: 'changed' }),
      bridge.createProject('D:/workspace', 'new-project'),
      bridge.runProject('D:/workspace'),
      bridge.startPreview('D:/workspace', 'index.html'),
      bridge.gitStage('.'),
    ]);

    expect(results.every(result => !result.success)).toBe(true);
    expect(results.every(result => JSON.stringify(result).includes('disabled in Chat mode'))).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('allows a workspace write after the user switches that workspace to Agent mode', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ json: async () => ({ success: true }) });
    vi.stubGlobal('fetch', fetchMock);
    const bridge = new ApiBridge();
    bridge.setConversationModeContext('D:/workspace', 'chat');
    bridge.setConversationModeContext('D:/workspace', 'agent');

    await expect(bridge.writeFile('index.html', '<h1>changed</h1>')).resolves.toEqual({ success: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestInit = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(requestInit.body))).toMatchObject({ conversationMode: 'agent' });
  });

  it('fails closed until an active workspace mode has loaded', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const bridge = new ApiBridge();

    await expect(bridge.runCommand('npm test')).resolves.toMatchObject({ success: false, error: expect.stringContaining('Chat mode') });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('temporarily locks a newly opened workspace to Chat until its saved mode is loaded', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ json: async () => ({ success: true, path: 'D:/new-workspace' }) });
    vi.stubGlobal('fetch', fetchMock);
    const bridge = new ApiBridge();
    bridge.setConversationModeContext('D:/old-workspace', 'agent');

    await bridge.setRoot('D:/new-workspace');
    const blockedWrite = await bridge.writeFile('index.html', 'should not write during workspace switch');

    expect(blockedWrite).toMatchObject({ success: false, error: expect.stringContaining('Chat mode') });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
