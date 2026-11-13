# Quillix edit checkpoints (no git repo)  20261108-085251 : App.tsx, DashboardView.tsx (M-TURBO-1 unify Home Turbo toggle onto persisted global state) 
M99-crashboundary-090556 : main.tsx, package.json (M9.9 crash boundary + reporter)

20261108-085251 : src/App.tsx, src/components/DashboardView.tsx (M-TURBO-1)
M99-crashboundary-<HHMMSS under _checkpoints/M99-crashboundary-090556> : src/main.tsx, package.json (M9.9)
M65-provider-limits-20261108-101136 : src/components/ProviderProfiles.tsx (M6.5 saved-provider limits editor; .post-fix snapshot for reference)
M75-health/20261108-103117 : src/server/universal.ts, src/shared/types.ts (M7.5 provider health summary)
M98-a11y-20261108-105538 : src/components/ChatPanel.tsx, DiagnosticsModal.tsx, ToolRegistryPanel.tsx, TerminalPanel.tsx (M9.8 a11y increment)
M98-a11y-20261108-110041 : src/components/ChatPanel.tsx, Composer.tsx (composer focus ref; Escape/focus pattern follow-up)
M75-studio-monitor-20261108-125408 : src/services/apiBridge.ts, src/components/WorkbenchLayout.tsx, package.json (M7.5 Studio health monitor)
MISSION-CONTROL-20261108-143452 : src/shared/missionState.ts, src/server/__tests__/missionState.test.ts, server.ts, src/services/apiBridge.ts, src/components/MissionControlPanel.tsx, src/components/WorkbenchLayout.tsx, package.json, .clinerules/quillix-mission.md, .quillix/mission/*, extensions/quillix-mission-control/*, scripts/smoke/mission-control-contract.mjs (QUILLIX MISSION CONTROL tracker)
M15-rag-incremental-<HHMMSS under _checkpoints/M15-rag-incremental-20261108-152832> : src/server/projectRag.ts, server.ts, src/services/apiBridge.ts, src/server/agentEngine.ts, package.json, src/server/__tests__/projectRagIncremental.test.ts, scripts/smoke/rag-incremental-contract.mjs (M1.5 incremental re-index)
M23-approval-batch-<HHMMSS under _checkpoints/M23-approval-batch-20261108-154016> : src/server/approvalBatch.ts (new), server.ts, src/services/apiBridge.ts, package.json, src/server/__tests__/approvalBatch.test.ts (new), scripts/smoke/approval-batch-contract.mjs (new) (M2.3 batch approve/reject backend)
M14-M23-UI-<HHMMSS under _checkpoints/M14-M23-UI-20261108-160857> : src/server/codebaseQa.ts (new), src/server/approvalBatch.ts, server.ts, src/services/apiBridge.ts, src/components/WorkbenchLayout.tsx, package.json, __tests__/codebaseQa.test.ts (new), __tests__/approvalBatch.test.ts, scripts/smoke/codebase-qa-contract.mjs (new), scripts/smoke/approval-batch-contract.mjs (M1.4 codebase Q&A + M2.3 Studio review bar, Cline after Kilo went inactive)

M4-NIM-FAILOVER-20261108-210534 : src\server\nimModels.ts, src\server\nvidiaFailover.ts, src\server\nvidia.ts, src\server\sarvam.ts, src\server\settings.ts, src\shared\types.ts, src\components\SettingsScreen.tsx, src\server\__tests__\nvidiaFailover.test.ts, src\server\__tests__\nimModels.test.ts, scripts\smoke\nim-failover-contract.mjs, server.ts, package.json (Part 4 NVIDIA NIM multi-model auto-failover: model discovery, failover wrapper, health routes, settings priority, Studio dashboard)

P3-SELF-HEALING-20261109-022200 : src\server\selfHealing.ts (new), src\server\selfHealingRuntime.ts (new), src\server\__tests__\selfHealing.test.ts (new), src\server\agentEngine.ts, server.ts, src\shared\types.ts, src\services\apiBridge.ts, src\components\TerminalPanel.tsx, scripts\smoke\self-healing-contract.mjs (new), package.json (Part 3 terminal self-healing: failure classification, deterministic repair strategies, verification re-run, repair history API + Terminal panel)

BUGFIX-REPLACE-INTENT-20261111-195000 : writeIntent.ts, intentRouter.ts, server.ts, WorkbenchLayout.tsx, DeveloperCockpit.tsx (Fix replace intent misclassified as chat, fix contradictory chat system prompt when in agent mode, Studio header quick buttons)

UI-SHADOWS-ANIMATIONS-20261111-195800 : production-ui.css, atlas.css, variants-interaction.ts (Fix overlapping dark shadow blinds on recent project list, cardHoverVariants idle boxShadow none, gap and rounded card layout)
