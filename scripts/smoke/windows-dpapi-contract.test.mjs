/** No secrets, credentials, or live Windows key storage are needed here. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dpapi, checkWindowsSarvamStorage } from '../../src/server/sarvam.ts';

function fakeRuntime(secret = 'test-secret-for-quillix') {
  const calls = [];
  const ciphertext = Buffer.from('encrypted-data-from-windows-dpapi').toString('base64');
  const spawn = (bin, args, options) => {
    const script = Buffer.from(args.at(-1), 'base64').toString('utf16le');
    calls.push({ bin, args, options, script });
    assert.match(script, /DataProtectionScope\]::CurrentUser/);
    assert.match(script, /Add-Type -AssemblyName System.Security -ErrorAction Stop/);
    assert.match(script, /Add-Type -AssemblyName System.Security.Cryptography.ProtectedData/);
    assert.ok(script.indexOf('Add-Type -AssemblyName System.Security') < script.indexOf('::Protect(') || !script.includes('::Protect('), 'load DPAPI assembly before calling Protect');
    assert.ok(!args.join(' ').includes(secret), 'the API key must not be in argv');
    assert.ok(!script.includes(secret), 'the API key must not be embedded in the PowerShell script');
    assert.deepEqual(args.slice(0, 4), ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand']);
    if (script.includes('::Protect(')) {
      assert.equal(Buffer.from(options.input, 'base64').toString('utf8'), secret);
      return { status: 0, stdout: ciphertext, stderr: '', error: undefined };
    }
    assert.equal(options.input, ciphertext);
    return { status: 0, stdout: Buffer.from(secret, 'utf8').toString('base64'), stderr: '', error: undefined };
  };
  return { runtime: { platform: 'win32', env: { SystemRoot: 'C:\\Windows' }, exists: () => true, spawn }, calls, ciphertext };
}

test('Windows DPAPI uses CurrentUser, no secret in command line and safe base64 transport', () => {
  const { runtime, calls, ciphertext } = fakeRuntime();
  assert.equal(dpapi('protect', 'test-secret-for-quillix', runtime), ciphertext);
  assert.equal(dpapi('unprotect', ciphertext, runtime), 'test-secret-for-quillix');
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => call.bin.toLowerCase().includes('powershell.exe')));
});

test('Windows DPAPI falls back to a PATH command when the absolute executable cannot launch', () => {
  const { runtime, ciphertext } = fakeRuntime();
  const actualSpawn = runtime.spawn;
  const attempted = [];
  runtime.spawn = (binary, args, options) => {
    attempted.push(binary);
    if (binary.toLowerCase().includes('windows\\system32') || binary.toLowerCase().includes('windows\\sysnative')) {
      return { status: null, error: Object.assign(new Error('missing'), { code: 'ENOENT' }), stdout: '', stderr: '' };
    }
    return actualSpawn(binary, args, options);
  };
  assert.equal(dpapi('protect', 'test-secret-for-quillix', runtime), ciphertext);
  assert.ok(attempted.includes('powershell.exe'));
});

test('Windows DPAPI refuses missing PowerShell and does not leak the supplied key in the error', () => {
  const secret = 'do-not-print-this-secret';
  const runtime = {platform:'win32', env:{}, exists:() => false, spawn:() => ({status:null,error:Object.assign(new Error('missing'),{code:'ENOENT'}),stdout:'',stderr:''})};
  assert.throws(() => dpapi('protect', secret, runtime), e => e.message.includes('PowerShell was not found') && !e.message.includes(secret));
});

test('Windows DPAPI shows only classified exception types, never raw stderr or key', () => {
  const secret = 'do-not-print-this-secret';
  const runtime = {platform:'win32', env:{}, exists:() => false, spawn:() => ({status:10,stdout:'',stderr:`DPAPI_ERROR:CryptographicException user context ${secret}`})};
  assert.throws(() => dpapi('protect', secret, runtime), e => e.message.includes('CryptographicException') && !e.message.includes(secret));
});

test('Windows DPAPI does not save plaintext in unsupported environments', () => {
  assert.throws(() => dpapi('protect','test-secret-for-quillix', {platform:'linux'}), /Secure API key storage is supported on Windows/);
  if (process.platform !== 'win32') assert.equal(checkWindowsSarvamStorage().ok, false);
});


test('Windows PowerShell 5.1 missing DPAPI type yields actionable, nonsecret guidance', () => {
  const secret = 'do-not-print-this-secret';
  const runtime = {
    platform:'win32', env:{}, exists:() => false,
    spawn:() => ({status:10, stdout:'', stderr:'DPAPI_ERROR:ProtectedDataTypeUnavailable'}),
  };
  assert.throws(() => dpapi('protect', secret, runtime), e =>
    e.message.includes('DPAPI libraries could not be loaded') && !e.message.includes(secret));
});

test('Windows DPAPI still reports safely when script produces an opaque RuntimeException', () => {
  const secret = 'do-not-print-this-secret';
  const runtime = {
    platform:'win32', env:{}, exists:() => false,
    spawn:() => ({status:10, stdout:'', stderr:`DPAPI_ERROR:RuntimeException ${secret}`}),
  };
  assert.throws(() => dpapi('protect', secret, runtime), e =>
    e.message.includes('RuntimeException') && !e.message.includes(secret));
});
