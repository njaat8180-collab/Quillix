# Windows Sarvam API key save repair

## Symptom

`Windows user-protected API key storage is unavailable. Verify PowerShell and your Windows user profile.`

## Technical changes

- Use the real Windows PowerShell location when available, falling back to `powershell.exe` and `pwsh.exe`.
- Use `-EncodedCommand` for the static DPAPI script; never include secret text in command arguments.
- Carry secret input as UTF-8 bytes encoded to base64 over stdin; carry DPAPI ciphertext as base64; never log plaintext.
- Use `CurrentUser` scope, with no plaintext fallback.
- Run a DPAPI protect/unprotect check before changing the existing saved encrypted key.
- Report only bounded, nonsecret error categories to Settings; show guidance at the API key field.
- Add a credential-free live test: `npm run check:sarvam-storage`.
- Add mocked Windows DPAPI tests to the smoke suite.

## Limitations

Automated tests here do not run Windows PowerShell itself or a real Sarvam API request. A restrictive Windows account policy can still prevent DPAPI access. No software guarantees a successful save when Windows' secure storage is unavailable.

## Commands on Windows

```powershell
npm ci
npm run check:sarvam-storage
npm start
```

In the app, save the API key and run **Test Sarvam Connection**. Never share the key or include it in support logs.

## October 12 DPAPI RuntimeException hotfix

- Load `System.Security` (Windows PowerShell 5.1) or `System.Security.Cryptography.ProtectedData` (PowerShell 7) before accessing the DPAPI type. A missing assembly can otherwise produce an unhelpful `RuntimeException` even for a normal signed-in Windows user.
- Report a specific sanitized message if the DPAPI type cannot be loaded, instead of exposing stderr or credentials.
- Clear previous local Ollama connection messages when switching to Sarvam.
- Added static Windows PowerShell contract tests for both assembly-loading variants and safe error handling.
- The mocked tests below do not prove that live Windows DPAPI succeeds; run `npm run check:sarvam-storage` on the actual Windows user profile, then save a key and run Test Sarvam Connection.
