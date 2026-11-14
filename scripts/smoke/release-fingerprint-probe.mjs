import { releaseSourceFingerprint } from './release-source-fingerprint.mjs';

console.log(releaseSourceFingerprint(process.argv[2] || process.cwd()));
