$path='D:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\src\components\Composer.tsx'
$content = Get-Content -LiteralPath $path -Raw

# Fix mode buttons spacing
$content = $content -replace 'className="flex items-center gap-1 px-3 pt-1\.5 flex-wrap"', 'className="flex items-center gap-2 px-4 pt-2 flex-wrap"'
$content = $content -replace 'className=\{`px-2\.5 py-1 rounded-full text-\[11px\] font-semibold q-transition', 'className={`px-3 py-1.5 rounded-full text-[11px] font-semibold q-transition'

# Fix textarea padding and line-height
$content = $content -replace 'className="w-full bg-transparent px-4 py-3 text-sm text-\[var\(--text\)\] placeholder-\[var\(--text-muted\)\] outline-none resize-none min-h-\[56px\]"', 'className="w-full bg-transparent px-4 py-3.5 text-sm leading-relaxed text-[var(--text)] placeholder-[var(--text-muted)] outline-none resize-none min-h-[56px]"'

Set-Content -LiteralPath $path -Value $content
'Composer.tsx updated'
