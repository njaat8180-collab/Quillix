/** Narrow verifier repair for an explicit shared toCents backend contract. */
export function repairSharedMoneyContract(
  moneySource: string,
  checkoutSource: string,
): { money: string; checkout: string; changed: boolean } {
  const money = moneySource.replace(/Math\.floor\(\s*Number\(\s*amount\s*\)\s*\*\s*100\s*\)/g, 'Math.round(Number(amount) * 100)');
  if (!/toCents/.test(moneySource) || !/totalCents/.test(checkoutSource)) {
    return { money: moneySource, checkout: checkoutSource, changed: false };
  }
  const checkout = checkoutSource
    .replace(/reduce\(\s*\(\s*sum\s*,\s*amount\s*\)\s*=>\s*sum\s*\+\s*Math\.floor\(\s*Number\(\s*amount\s*\)\s*\*\s*100\s*\)\s*,\s*0\s*\)/g, 'reduce((sum, amount) => sum + toCents(amount), 0)')
    .replace(/reduce\(\s*\(\s*sum\s*,\s*amount\s*\)\s*=>\s*sum\s*\+\s*Math\.round\(\s*Number\(\s*amount\s*\)\s*\*\s*100\s*\)\s*,\s*0\s*\)/g, 'reduce((sum, amount) => sum + toCents(amount), 0)');
  return money === moneySource && checkout === checkoutSource
    ? { money: moneySource, checkout: checkoutSource, changed: false }
    : { money, checkout, changed: true };
}
