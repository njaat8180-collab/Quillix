# Sarvam AI setup

1. Open NUVRO AI > Settings > AI > Provider > Sarvam AI.
2. Paste your Sarvam API key and click **Save & Connect**. This securely saves it, then performs one real model connection check. The key can be saved even if the cloud test fails.
3. Sarvam selection switches Offline Mode off (cloud use requires internet). The status reads Connected only after a nonempty reply from the model.
4. Close Settings and request a project, such as "Create a calculator website with HTML, CSS and JavaScript".
5. NUVRO AI routes agent tool calls to Sarvam 105B and executes local file-writing tools subject to the existing approval and verification system.

The API key is kept server-side. On Windows, it is encrypted using DPAPI before being saved to `~/.quillix/sarvam-key.dpapi.json`. It is never included in settings JSON or returned by the settings API. Use **Remove Key** to delete the stored key. The UI reports only whether a key is configured.

**Verification:** No live API call was possible without a user-supplied key. The environment could not complete `npm ci`, so TypeScript lint and end-to-end tests remain unverified. This is a candidate build, not an independently confirmed production-ready release.

Sarvam API: `https://api.sarvam.ai/v1/chat/completions`, model `sarvam-105b`.


## Security and connection check (updated)

On Windows, **Save API Key** encrypts the key with Windows DPAPI (CurrentUser),
then writes only ciphertext to `~/.quillix/sarvam-key.dpapi.json`.
The old plaintext `sarvam-key.json` is migrated and deleted when accessible.
The key is never returned by `/api/settings`. A different Windows login
cannot decrypt this file. For Linux/macOS test environments, provide
`SARVAM_API_KEY` as a process environment variable; UI key saving will
fail closed rather than write unencrypted secrets.

Choose Sarvam, turn Offline Mode OFF, save the key, then click
**Test Sarvam Connection**. This makes a small API call that may consume
credits and shows only a connected status or a sanitized error.
**Remove Key** removes the local saved key; environment-supplied keys
remain active until removed from the environment.

A working provider ping does not prove file-generation/agent flows work.
Those require separate actual-project verification.

## Provider compatibility notes

Sarvam V1 supports native tool calls, `temperature`, and `response_format` JSON schema.
The adapter maps the coding agent's system instruction, tool results, and
forced file-output format into the V1 request. Unless overridden, generation
allows up to 8192 output tokens so multi-file coding does not hit the short
2048-token API default. Real usage may incur costs.

**Verification as of 2026-10-11:** Mock-based Sarvam provider checks and
TypeScript syntax/transpilation checks completed in the authoring environment.
Windows DPAPI execution, live API credentials, dependency-complete build, and
real filesystem project-generation tests **have not yet been verified**.

## Troubleshooting: Windows user-protected API key storage unavailable

If NUVRO AI shows a Windows DPAPI/PowerShell storage error when saving your API key:

1. Update to the secure-storage repair build, close older NUVRO AI processes, and open the extracted new NUVRO AI folder.
2. In PowerShell, run `npm run check:sarvam-storage`. This checks encryption and decryption with a **dummy string**. It does not need your Sarvam API key and does not save a key.
3. If it says PASS, start the updated NUVRO AI with `npm start`, choose Sarvam, and save your API key in **Settings > AI**. Then click **Test Sarvam Connection** (this uses real API credits).
4. If it says FAIL, run `Get-Command powershell.exe` to check that Windows PowerShell is available. Start the app from your normal signed-in Windows user profile (not another account, service, or SYSTEM) and repeat the self-test. If your PC's policy blocks PowerShell or DPAPI, ask your administrator; **do not turn off security protection**.
5. Do not paste the API key into any diagnostic command or send it in screenshots. Only report the PASS/FAIL message (redact your Windows username if needed).

This build tries the absolute Windows PowerShell executable path before PATH-based discovery, uses encoded **script** arguments and base64 over standard input to avoid quoting/encoding errors, reports a limited error type instead of silently swallowing failures, and checks DPAPI decryption before replacing an existing encrypted key. It never falls back to plaintext storage.

**Validation:** Automated cross-platform mock tests cover the Windows DPAPI request contract, missing PowerShell, sanitized errors, and fallback resolution. Real DPAPI and Sarvam credentials must be verified on the target Windows PC. `npm run check:sarvam-storage` is the live local diagnostic.


For the 2026-10-12 code-writing tool fix and tests, see `QUILLIX_SARVAM_CODING_RELIABILITY_2026-10-12.md`.

## v1.1.1 compatibility

See `QUILLIX_SARVAM_COMPATIBILITY_v1.1.1.md` for Starter-tier token budgeting, bounded retry/error handling, secure saved-key precedence, test evidence and Windows acceptance instructions.
