$root='D:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\src'
$css = Get-Content -LiteralPath "$root\production-ui.css" -Raw

# --- Top header: fix cramped status pills ---
$css = $css -replace '\.q-topbar nav \{\s*height: auto;\s*padding: 3px;\s*gap: 2px;\s*border: 1px solid var\(--border\);\s*border-radius: 12px;\s*background: var\(--surface\);\s*\}', '.q-topbar nav {
  height: auto;
  padding: 4px;
  gap: 4px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface);
}'

# --- Chat history: better title line-clamp ---
$css = $css -replace '\-webkit-line-clamp: 2; overflow-wrap: anywhere; font-size: 13px; line-height: 1\.4; font-weight: 650; margin-bottom: 2px; \}', '-webkit-line-clamp: 1; overflow-wrap: anywhere; font-size: 13px; line-height: 1.4; font-weight: 650; margin-bottom: 3px; }'

# --- Dashboard / home launch textarea alignment ---
$css = $css -replace '\.q-atlas-launch textarea \{ font-size: 16px; \}', '.q-atlas-launch textarea { font-size: 15px; line-height: 1.5; padding: 12px; }'

# --- Agent welcome suggestions spacing ---
$css = $css -replace '\.q-agent-welcome > p,\r?\n\.q-agent-suggestions > button \{ font-size: 13px; \}', '.q-agent-welcome > p { font-size: 14px; line-height: 1.6; margin: 10px 0 0; }
.q-agent-suggestions > button { font-size: 13px; }'

# --- Editor empty state better spacing ---
$css = $css -replace '\.q-editor-empty > p,\r?\n\.q-shortcut-row \{ font-size: 13px; color: var\(--text-muted\); \}', '.q-editor-empty > p { font-size: 14px; line-height: 1.6; margin: 8px 0 0; }
.q-shortcut-row { font-size: 13px; color: var(--text-muted); }'

Set-Content -LiteralPath "$root\production-ui.css" -Value $css
'production-ui.css updated'
