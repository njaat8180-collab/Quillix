import React, { useRef, useState, useCallback, useEffect } from 'react';
import { RefreshCw, X, ExternalLink, MonitorPlay, Radio, Play, Square, AlertTriangle, Smartphone, Tablet, Monitor } from 'lucide-react';
import { api } from '../services/apiBridge.js';

export const PREVIEW_LIVE_REFRESH_MS = 2000;
type PreviewViewport = 'responsive' | 'mobile' | 'tablet' | 'desktop';

interface PreviewPaneProps {
  /** Absolute project root on disk. */
  root: string;
  /** Entry file (index.html) relative to the project root. */
  entry: string;
  /** Project display name. */
  title?: string;
  onClose: () => void;
  disabled?: boolean;
}

/**
 * Built-in web preview: renders the project's entry HTML inside NUVRO AI via
 * the loopback-only /preview static server. The preview re-mounts the iframe
 * on refresh (true reload, not a cached view).
 */
export const PreviewPane: React.FC<PreviewPaneProps> = ({ root, entry, title, onClose, disabled = false }) => {
  const [nonce, setNonce] = useState(0);
  const [showUrl, setShowUrl] = useState(false);
  const [previewOrigin, setPreviewOrigin] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [previewStatus, setPreviewStatus] = useState<'starting' | 'ready' | 'stopped' | 'failed'>('starting');
  const sessionRef = useRef<string | null>(null);
  const [liveRefresh, setLiveRefresh] = useState(true);
  const [viewport, setViewport] = useState<PreviewViewport>('responsive');
  const frameRef = useRef<HTMLIFrameElement>(null);
  const missingEntryRetries = useRef(0);
  const retryTimerRef = useRef<number | null>(null);
  const startPreviewRef = useRef<(resetRetry?: boolean) => Promise<void>>(async () => undefined);

  const startPreview = useCallback(async (resetRetry = false) => {
    if (disabled) return;
    if (resetRetry) missingEntryRetries.current = 0;
    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    setPreviewStatus('starting');
    setPreviewError('');
    setPreviewOrigin(null);
    try {
      const data = await api.startPreview(root, entry);
      if (!data.success || !data.session || !data.origin || !/^http:\/\/127\.0\.0\.1:\d{1,5}$/.test(data.origin)) {
        throw new Error(data.error || 'The isolated preview server is unavailable.');
      }
      sessionRef.current = data.session.id;
      setPreviewOrigin(data.origin);
      setPreviewStatus(data.session.status);
    } catch (error: any) {
      const message = error?.message || 'Preview could not start.';
      // A task may still be writing its entry file when the user opens
      // Preview. Treat that transient state as loading and retry in the
      // background instead of presenting a misleading permanent failure.
      if (/preview entry (?:could not be read|was not found)/i.test(message) && missingEntryRetries.current < 45) {
        missingEntryRetries.current += 1;
        setPreviewStatus('starting');
        setPreviewError(`Waiting for ${entry} to be created… (${missingEntryRetries.current}/45)`);
        retryTimerRef.current = window.setTimeout(() => {
          retryTimerRef.current = null;
          void startPreviewRef.current(false);
        }, 1000);
        return;
      }
      setPreviewStatus('failed');
      setPreviewError(message);
    }
  }, [root, entry, disabled]);

  startPreviewRef.current = startPreview;

  useEffect(() => {
    void startPreview(true);
    return () => {
      if (retryTimerRef.current !== null) window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
      const id = sessionRef.current;
      sessionRef.current = null;
      if (id) void api.stopPreview(id).catch(() => undefined);
    };
  }, [startPreview]);

  useEffect(() => {
    if (!sessionRef.current || previewStatus !== 'ready') return;
    const timer = window.setInterval(async () => {
      const id = sessionRef.current;
      if (!id) return;
      try {
        const data = await api.getPreviewStatus(id);
        if (!data.session || data.session.status === 'failed' || data.session.status === 'stopped') {
          setPreviewStatus(data.session?.status || 'failed');
          setPreviewError(data.session?.error || 'Preview session stopped. Start it again or return to the editor.');
        }
      } catch {
        setPreviewStatus('failed');
        setPreviewError('Preview status could not be read. Check that NUVRO AI is still running.');
      }
    }, 1500);
    return () => window.clearInterval(timer);
  }, [previewStatus]);

  const relPath = root ? `${root}/${entry}` : entry;
  const assetPath = `/preview/${relPath.split(/[\\/]/).map(encodeURIComponent).join('/')}`;
  const src = previewOrigin ? `${previewOrigin}${assetPath}?_r=${nonce}` : '';
  const viewportWidth = viewport === 'mobile' ? 390 : viewport === 'tablet' ? 768 : viewport === 'desktop' ? 1280 : undefined;
  const waitingForEntry = previewStatus === 'starting' && /^Waiting for .* to be created/.test(previewError);

  const refresh = useCallback(() => {
    setNonce((n) => n + 1);
  }, []);

  const stopPreview = useCallback(async () => {
    const id = sessionRef.current;
    if (id) await api.stopPreview(id).catch(() => undefined);
    sessionRef.current = null;
    setPreviewOrigin(null);
    setPreviewStatus('stopped');
    setPreviewError('Preview stopped. Start it again or return to the editor.');
  }, []);

  useEffect(() => {
    if (!liveRefresh) return;
    const timer = window.setInterval(refresh, PREVIEW_LIVE_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [liveRefresh, refresh]);

  const openExternally = useCallback(() => {
    // Open in the user's default browser (loopback URL, same as the iframe).
    if (!previewOrigin) return;
    window.open(`${previewOrigin}${assetPath}?_r=${Date.now()}`, '_blank', 'noopener,noreferrer');
  }, [previewOrigin, assetPath]);

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-white" role="region" aria-label="Built-in preview">
      {/* Preview toolbar */}
      <div className="h-9 px-2.5 flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface)] shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <MonitorPlay size={14} style={{ color: 'var(--accent)' }} />
          <span className="text-[11.5px] font-semibold text-[var(--text)] truncate">
            Preview{title ? ` — ${title}` : ''}
          </span>
          <span className="text-[10.5px] font-mono text-[var(--text-muted)] truncate hidden md:inline" title={relPath}>
            {relPath}
          </span>
          <span
            className="text-[10px] font-semibold uppercase tracking-wide"
            style={{ color: previewStatus === 'ready' ? 'var(--success)' : previewStatus === 'failed' ? 'var(--danger)' : 'var(--text-muted)' }}
            aria-live="polite"
          >
            {previewStatus === 'ready' ? '● READY' : previewStatus === 'starting' ? '○ STARTING' : previewStatus === 'stopped' ? '○ STOPPED' : '● ERROR'}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {previewStatus === 'ready' ? (
            <button
              onClick={() => void stopPreview()}
              title="Stop local preview"
              aria-label="Stop local preview"
              className="q-transition p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-[var(--hover)]"
            >
              <Square size={13} />
            </button>
          ) : (
            <button
              onClick={() => void startPreview(true)}
              title="Start local preview"
              aria-label="Start local preview"
              className="q-transition p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--hover)]"
            >
              <Play size={13} />
            </button>
          )}
          <button
            onClick={() => setLiveRefresh((value) => !value)}
            title={liveRefresh ? 'Live preview is on — reloads every 2 seconds' : 'Turn on live preview — reloads every 2 seconds'}
            aria-label={liveRefresh ? 'Turn off live preview' : 'Turn on live preview'}
            aria-pressed={liveRefresh}
            className="q-transition flex items-center gap-1 px-1.5 py-1 rounded-lg text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--hover)]"
            style={liveRefresh ? { color: 'var(--success)' } : undefined}
          >
            <Radio size={13} />
            <span className="text-[10px] hidden sm:inline">{liveRefresh ? 'LIVE · 2s' : 'LIVE OFF'}</span>
          </button>
          <button
            onClick={() => setShowUrl((v) => !v)}
            title="Show preview URL"
            aria-label="Show preview URL"
            className="q-transition p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--hover)]"
          >
            <span className="text-[11px] font-mono px-0.5">URL</span>
          </button>
          <button
            disabled={!previewOrigin || previewStatus !== 'ready'}
            onClick={openExternally}
            title="Open in default browser"
            aria-label="Open in default browser"
            className="q-transition p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--hover)]"
          >
            <ExternalLink size={14} />
          </button>
          <button
            disabled={!previewOrigin || previewStatus !== 'ready'}
            onClick={refresh}
            title="Reload preview"
            aria-label="Reload preview"
            className="q-transition p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--hover)]"
          >
            <RefreshCw size={14} />
          </button>
          <div className="hidden md:flex items-center gap-0.5 border-l border-[var(--border)] pl-1 ml-0.5" role="group" aria-label="Preview viewport">
            {([
              ['responsive', MonitorPlay, 'Responsive preview'],
              ['mobile', Smartphone, 'Mobile 390px preview'],
              ['tablet', Tablet, 'Tablet 768px preview'],
              ['desktop', Monitor, 'Desktop 1280px preview'],
            ] as const).map(([mode, Icon, label]) => (
              <button
                key={mode}
                type="button"
                onClick={() => setViewport(mode)}
                title={label}
                aria-label={label}
                aria-pressed={viewport === mode}
                className="q-transition p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--hover)]"
                style={viewport === mode ? { color: 'var(--accent)', background: 'var(--accent-soft)' } : undefined}
              >
                <Icon size={13} />
              </button>
            ))}
          </div>
          <button
            onClick={onClose}
            title="Close preview"
            aria-label="Close preview"
            className="q-transition p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--hover)]"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {showUrl && (
        <div className="px-2.5 py-1.5 border-b border-[var(--border)] bg-[var(--input)] text-[10.5px] font-mono text-[var(--text-muted)] truncate">
          {src.split('?')[0]}
        </div>
      )}

      {/* Separate loopback origin prevents generated code from calling NUVRO AI APIs
          while allowing each project's localStorage and normal browser scripts. */}
      {waitingForEntry ? (
        <div role="status" className="p-4 text-sm text-[var(--text-muted)]">{previewError}</div>
      ) : previewError ? (
        <div role="alert" className="p-4 text-red-700 text-sm space-y-3">
          <div className="flex items-start gap-2"><AlertTriangle size={16} className="shrink-0 mt-0.5" /><span>{previewError}</span></div>
          <div className="flex gap-2">
            <button type="button" onClick={() => void startPreview(true)} className="q-button-outline px-2.5 py-1.5 rounded-lg text-xs">Retry preview</button>
            <button type="button" onClick={onClose} className="q-button-outline px-2.5 py-1.5 rounded-lg text-xs">Back to code</button>
          </div>
        </div>
      ) : !previewOrigin || previewStatus === 'starting' ? (
        <div className="p-4 text-sm text-[var(--text-muted)]">Starting isolated local preview…</div>
      ) : (
        <div className="flex-1 min-h-0 overflow-auto bg-[var(--surface-secondary)] flex justify-center">
          <iframe
            ref={frameRef}
            key={nonce}
            src={src}
            title={`NUVRO AI built-in preview${title ? ` — ${title}` : ''}`}
            className="h-full min-h-0 border-0 bg-white shadow-sm transition-[width] duration-200"
            style={{ width: viewportWidth ? `${viewportWidth}px` : '100%', maxWidth: '100%' }}
            sandbox="allow-scripts allow-same-origin allow-forms allow-modals"
            onLoad={() => setPreviewStatus('ready')}
            onError={() => { setPreviewStatus('failed'); setPreviewError('The preview document could not be loaded. Check the entry file and local assets.'); }}
          />
        </div>
      )}
    </div>
  );
};
