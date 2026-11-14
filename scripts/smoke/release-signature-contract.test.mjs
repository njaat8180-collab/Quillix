import assert from 'node:assert/strict';
import test from 'node:test';
import { releaseSignatureReport } from './release-signature-contract.mjs';

test('unsigned local artifacts warn, while production requires valid app and installer signatures', () => {
  const local = releaseSignatureReport({ appStatus: 'NotSigned', installerStatus: 'NotSigned' });
  assert.equal(local.status, 'WARN');
  assert.equal(local.signatures.app, 'NotSigned');
  assert.equal(local.signatures.installer, 'NotSigned');

  const production = releaseSignatureReport({ required: true, appStatus: 'NotSigned', installerStatus: 'NotSigned' });
  assert.equal(production.status, 'FAIL');

  const signed = releaseSignatureReport({ required: true, appStatus: 'Valid', installerStatus: 'Valid' });
  assert.equal(signed.status, 'PASS');
});

test('a missing installer cannot pass the required release signature gate', () => {
  const report = releaseSignatureReport({ required: true, appStatus: 'Valid', installerStatus: 'Unknown', installerExists: false });
  assert.equal(report.status, 'FAIL');
  assert.equal(report.signatures.installer, 'Missing');
  assert.match(report.error, /installer was not found/i);
});
