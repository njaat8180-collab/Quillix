import fs from 'node:fs';

const [quillixPath, referencePath] = process.argv.slice(2);
if (!quillixPath || !referencePath) {
  console.error('Usage: node scripts/smoke/report-public-benchmark.mjs <quillix-summary.json> <public-reference.json>');
  process.exit(2);
}
const read = path => JSON.parse(fs.readFileSync(path, 'utf8'));
const local = read(quillixPath);
const reference = read(referencePath);
if (!Number.isFinite(local.aggregate?.passRatePercent) || !local.aggregate?.total) throw new Error('Quillix summary lacks a completed pass-rate aggregate.');
if (!reference.benchmark || !reference.system || !reference.sourceUrl || !/^https:\/\//i.test(reference.sourceUrl) ||
    !reference.publishedAt || !Number.isFinite(reference.scorePercent) || reference.scorePercent < 0 || reference.scorePercent > 100) {
  throw new Error('Reference must include benchmark, system/scaffold, https sourceUrl, publishedAt, and scorePercent from 0 to 100.');
}
const report = {
  status: 'REFERENCE_ONLY',
  warning: 'Published score is not a controlled head-to-head comparison; benchmark, harness, hardware, model, and run settings may differ.',
  quillix: { model: local.model, protocol: local.protocol, cases: local.aggregate.total, passRatePercent: local.aggregate.passRatePercent },
  publicReference: { benchmark: reference.benchmark, system: reference.system, publishedAt: reference.publishedAt, sourceUrl: reference.sourceUrl, scorePercent: reference.scorePercent },
  comparison: 'Not computed: public aggregate scores may use different tasks, harnesses, repetitions, and hardware.',
};
console.log(JSON.stringify(report, null, 2));
