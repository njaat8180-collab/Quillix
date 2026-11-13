@echo off
cd /d "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix"
echo LINT_START >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_p3verify.log"
call npm run lint >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_p3verify.log" 2>&1
echo LINT_EXIT=%ERRORLEVEL% >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_p3verify.log"
echo TESTS_START >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_p3verify.log"
call npx vitest run src/server/__tests__/selfHealing.test.ts src/server/__tests__/agentCompletionContract.test.ts src/server/__tests__/agent.test.ts src/server/__tests__/repairFreshness.test.ts >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_p3verify.log" 2>&1
echo TESTS_EXIT=%ERRORLEVEL% >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_p3verify.log"
echo DONE_MARKER >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_p3verify.log"
