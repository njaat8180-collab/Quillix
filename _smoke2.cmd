@echo off
cd /d "
d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix
"
echo SMOKE2_START >> "
d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix
\_smoke2.log"
echo STEP_test:openai >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_smoke2.log"
call npm run test:openai >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_smoke2.log" 2>&1
echo STEP_EXIT_test:openai=%ERRORLEVEL% >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_smoke2.log"
echo STEP_test:universal >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_smoke2.log"
call npm run test:universal >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_smoke2.log" 2>&1
echo STEP_EXIT_test:universal=%ERRORLEVEL% >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_smoke2.log"
echo STEP_test:core >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_smoke2.log"
call npm run test:core >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_smoke2.log" 2>&1
echo STEP_EXIT_test:core=%ERRORLEVEL% >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_smoke2.log"
echo STEP_test:resilience >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_smoke2.log"
call npm run test:resilience >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_smoke2.log" 2>&1
echo STEP_EXIT_test:resilience=%ERRORLEVEL% >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_smoke2.log"
echo STEP_test:sarvam-contract >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_smoke2.log"
call npm run test:sarvam-contract >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_smoke2.log" 2>&1
echo STEP_EXIT_test:sarvam-contract=%ERRORLEVEL% >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_smoke2.log"
echo STEP_test:tool-parser >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_smoke2.log"
call npm run test:tool-parser >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_smoke2.log" 2>&1
echo STEP_EXIT_test:tool-parser=%ERRORLEVEL% >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_smoke2.log"
echo STEP_test:repair >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_smoke2.log"
call npm run test:repair >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_smoke2.log" 2>&1
echo STEP_EXIT_test:repair=%ERRORLEVEL% >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_smoke2.log"
echo STEP_test:atomic >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_smoke2.log"
call npm run test:atomic >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_smoke2.log" 2>&1
echo STEP_EXIT_test:atomic=%ERRORLEVEL% >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_smoke2.log"
echo STEP_test:windows-storage-contract >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_smoke2.log"
call npm run test:windows-storage-contract >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_smoke2.log" 2>&1
echo STEP_EXIT_test:windows-storage-contract=%ERRORLEVEL% >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_smoke2.log"
echo STEP_test:benchmark-contract >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_smoke2.log"
call npm run test:benchmark-contract >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_smoke2.log" 2>&1
echo STEP_EXIT_test:benchmark-contract=%ERRORLEVEL% >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_smoke2.log"
echo STEP_test:benchmark-artifact-contract >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_smoke2.log"
call npm run test:benchmark-artifact-contract >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_smoke2.log" 2>&1
echo STEP_EXIT_test:benchmark-artifact-contract=%ERRORLEVEL% >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_smoke2.log"
echo STEP_test:benchmark-summary >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_smoke2.log"
call npm run test:benchmark-summary >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_smoke2.log" 2>&1
echo STEP_EXIT_test:benchmark-summary=%ERRORLEVEL% >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_smoke2.log"
echo STEP_test:benchmark-quality >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_smoke2.log"
call npm run test:benchmark-quality >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_smoke2.log" 2>&1
echo STEP_EXIT_test:benchmark-quality=%ERRORLEVEL% >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_smoke2.log"
echo STEP_test:benchmark-compare >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_smoke2.log"
call npm run test:benchmark-compare >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_smoke2.log" 2>&1
echo STEP_EXIT_test:benchmark-compare=%ERRORLEVEL% >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_smoke2.log"
echo STEP_test:nsis-fallback-cleanup >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_smoke2.log"
call npm run test:nsis-fallback-cleanup >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_smoke2.log" 2>&1
echo STEP_EXIT_test:nsis-fallback-cleanup=%ERRORLEVEL% >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_smoke2.log"
echo STEP_test:tavily-demo >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_smoke2.log"
call npm run test:tavily-demo >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_smoke2.log" 2>&1
echo STEP_EXIT_test:tavily-demo=%ERRORLEVEL% >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_smoke2.log"
echo STEP_test:turbo-global-state >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_smoke2.log"
call npm run test:turbo-global-state >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_smoke2.log" 2>&1
echo STEP_EXIT_test:turbo-global-state=%ERRORLEVEL% >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_smoke2.log"
echo STEP_test:crash-boundary >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_smoke2.log"
call npm run test:crash-boundary >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_smoke2.log" 2>&1
echo STEP_EXIT_test:crash-boundary=%ERRORLEVEL% >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_smoke2.log"
echo STEP_test:provider-profile-limits >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_smoke2.log"
call npm run test:provider-profile-limits >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_smoke2.log" 2>&1
echo STEP_EXIT_test:provider-profile-limits=%ERRORLEVEL% >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_smoke2.log"
echo STEP_test:provider-health-monitor >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_smoke2.log"
call npm run test:provider-health-monitor >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_smoke2.log" 2>&1
echo STEP_EXIT_test:provider-health-monitor=%ERRORLEVEL% >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_smoke2.log"
echo STEP_test:mission-control >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_smoke2.log"
call npm run test:mission-control >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_smoke2.log" 2>&1
echo STEP_EXIT_test:mission-control=%ERRORLEVEL% >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_smoke2.log"
echo STEP_test:rag-incremental >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_smoke2.log"
call npm run test:rag-incremental >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_smoke2.log" 2>&1
echo STEP_EXIT_test:rag-incremental=%ERRORLEVEL% >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_smoke2.log"
echo STEP_test:approval-batch >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_smoke2.log"
call npm run test:approval-batch >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_smoke2.log" 2>&1
echo STEP_EXIT_test:approval-batch=%ERRORLEVEL% >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_smoke2.log"
echo STEP_test:codebase-qa >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_smoke2.log"
call npm run test:codebase-qa >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_smoke2.log" 2>&1
echo STEP_EXIT_test:codebase-qa=%ERRORLEVEL% >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_smoke2.log"
echo STEP_test:nim-failover >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_smoke2.log"
call npm run test:nim-failover >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_smoke2.log" 2>&1
echo STEP_EXIT_test:nim-failover=%ERRORLEVEL% >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_smoke2.log"
echo STEP_test:ui-accessibility >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_smoke2.log"
call npm run test:ui-accessibility >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_smoke2.log" 2>&1
echo STEP_EXIT_test:ui-accessibility=%ERRORLEVEL% >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_smoke2.log"
echo DONE_MARKER >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_smoke2.log"
