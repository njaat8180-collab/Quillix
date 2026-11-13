# NUVRO AI Dedicated OpenAI API — Release Candidate (2026-10-12)

## Changes

- Four independently selectable providers: Ollama, Sarvam AI, Dedicated OpenAI and Universal API.
- Dedicated OpenAI uses the official HTTPS Responses API and exact model ID;
  Universal API retains independent model, protocol, endpoint and credentials.
- OpenAI API key saved through Windows DPAPI for the current Windows account;
  environment variable fallback for non-Windows and automated tests.
- Home Quick Connect and Studio Settings provide OpenAI Save & Connect, Remove
  Key and honest verification state. Changing model/key invalidates the previous
  connection status rather than leaving a misleading Verified label.
- Coding-agent text, function calls and function results route through the
  selected OpenAI provider; incomplete or malformed results are rejected.
- Mocked OpenAI contract tests are part of the smoke-test script.

## Verification caveats

Offline API contract tests prove the constructed requests and parsed mocked
responses, not availability on a real OpenAI account. The Windows DPAPI storage
must be tested on Windows. If `npm ci`, `npm run lint` or `npm run build` fail
because dependencies cannot be installed, those steps remain unverified.

## Windows validation

1. Extract source ZIP into a fresh directory; open PowerShell in it.
2. `npm ci`
3. `npm run test:smoke`
4. `npm run lint`
5. `npm run build`
6. `npm start`
7. Home > Quick Connect > OpenAI / ChatGPT API. Enter key and exact model ID,
   select Save & Connect, and verify connection is reported only on success.
8. In Agent Mode ask NUVRO AI to create `index.html` with a Hello World heading
   and animated background, then inspect the actual written file.
9. Restart NUVRO AI and verify selected provider/model and encrypted key persist.

Do not include your API key in screenshots, bug reports, or saved project archives.
