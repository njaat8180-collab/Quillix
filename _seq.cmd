@echo off
cd /d "
d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix
"
echo FILE_agentCompletionContract_START >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_seq.log"
call npx vitest run src/server/__tests__/agentCompletionContract.test.ts >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_seq.log" 2>&1
echo FILE_agentCompletionContract_EXIT=%ERRORLEVEL% >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_seq.log"
echo FILE_repairFreshness_START >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_seq.log"
call npx vitest run src/server/__tests__/repairFreshness.test.ts >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_seq.log" 2>&1
echo FILE_repairFreshness_EXIT=%ERRORLEVEL% >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_seq.log"
echo FILE_agent_START >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_seq.log"
call npx vitest run src/server/__tests__/agent.test.ts >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_seq.log" 2>&1
echo FILE_agent_EXIT=%ERRORLEVEL% >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_seq.log"
echo FILE_codingWorkflow_START >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_seq.log"
call npx vitest run src/server/__tests__/codingWorkflow.test.ts >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_seq.log" 2>&1
echo FILE_codingWorkflow_EXIT=%ERRORLEVEL% >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_seq.log"
echo FILE_agentProjectFlow_START >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_seq.log"
call npx vitest run src/server/__tests__/agentProjectFlow.test.ts >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_seq.log" 2>&1
echo FILE_agentProjectFlow_EXIT=%ERRORLEVEL% >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_seq.log"
echo DONE_MARKER >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_seq.log"
