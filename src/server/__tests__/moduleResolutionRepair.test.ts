import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { repairMissingRelativeModule } from '../moduleResolutionRepair.js';

describe('missing relative module repair', () => {
  it('adds the only matching source extension without touching unrelated imports', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quillix-module-repair-'));
    try {
      fs.mkdirSync(path.join(root, 'src', 'domain'), { recursive: true });
      fs.mkdirSync(path.join(root, 'src', 'shared'), { recursive: true });
      fs.writeFileSync(path.join(root, 'src', 'shared', 'money.cjs'), 'exports.formatMoney = value => value;');
      const source = "const { formatMoney } = require('../shared/money');\nexports.run = formatMoney;\n";
      const repaired = repairMissingRelativeModule('src/domain/checkout.cjs', source, "Error: Cannot find module '../shared/money'", root);
      expect(repaired?.content).toContain("require('../shared/money.cjs')");
      expect(repaired?.content).toContain('exports.run = formatMoney');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
});
