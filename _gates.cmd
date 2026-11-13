@echo off
cd /d "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix"
echo GATE_LINT_START >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_gates.log"
call npm run lint >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_gates.log" 2>&1
echo GATE_LINT_EXIT=%ERRORLEVEL% >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_gates.log"
echo GATE_BUILD_START >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_gates.log"
call npm run build >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_gates.log" 2>&1
echo GATE_BUILD_EXIT=%ERRORLEVEL% >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_gates.log"
echo GATE_SMOKE_START >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_gates.log"
call npm run test:smoke >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_gates.log" 2>&1
echo GATE_SMOKE_EXIT=%ERRORLEVEL% >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_gates.log"
echo DONE_MARKER >> "d:\QUILLIX\Quillix_v1.2.0_Dedicated_OpenAI_Universal_Sarvam_2026-10-12\Quillix\_gates.log"
