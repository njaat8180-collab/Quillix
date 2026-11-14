export type BenchmarkReport = Record<string, any>;

const percentile = (values: number[], fraction: number) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[index];
};

const tokenAccountingFor = (entry: BenchmarkReport) => {
  const source = entry.observability?.tokenCountSource;
  const providerTokens = entry.observability?.actualTotalTokens;
  const estimatedTokens = entry.observability?.estimatedTotalTokens;
  const valid = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
  if ((source === 'provider' || source === 'mixed') && valid(providerTokens)) {
    return { tokens: providerTokens, source } as const;
  }
  if (source === 'estimate' && valid(estimatedTokens)) return { tokens: estimatedTokens, source: 'estimate' as const };
  if (entry.modelCalls === 0) return { tokens: 0, source: 'zero-call' as const };
  return { tokens: undefined, source: 'unaccounted' as const };
};

/** Keep successful quality separate from cost and failures across every attempt. */
export const aggregateBenchmarkReports = (entries: BenchmarkReport[]) => {
  const passed = entries.filter(entry => entry.completed && entry.checksPassed);
  const durations = passed.map(entry => Number(entry.durationMs || 0));
  const successfulTokenAccounting = passed.map(tokenAccountingFor);
  const tokens = successfulTokenAccounting.flatMap(value => value.tokens === undefined ? [] : [value.tokens]);
  const tokensPerFile = passed.map(entry => Number(entry.estimatedTokensPerWrittenFile || 0)).filter(value => value > 0);
  const toolCalls = passed.map(entry => Number(entry.tools?.length || 0));
  const attemptedDurations = entries.map(entry => Number(entry.durationMs || 0));
  const attemptedTokenAccounting = entries.map(tokenAccountingFor);
  const attemptedTokens = attemptedTokenAccounting.flatMap(value => value.tokens === undefined ? [] : [value.tokens]);
  const attemptedModelCalls = entries.map(entry => Number(entry.modelCalls || 0));
  const repairPhases = entries.map(entry => (Array.isArray(entry.phases) ? entry.phases : [])
    .filter((phase: any) => phase?.id === 'fixes' && phase.status !== 'skipped'));
  const hasRepairPhase = (entry: BenchmarkReport) => (Array.isArray(entry.phases) ? entry.phases : [])
    .some((phase: any) => phase?.id === 'fixes' && phase.status !== 'skipped');
  const failedAfterRepairCount = entries.filter(entry => (!entry.completed || !entry.checksPassed) && hasRepairPhase(entry)).length;
  const regressionRuns = {
    behavioralFailureRuns: entries.filter(entry => entry.behavioralChecksPassed === false).length,
    tokenBudgetFailureRuns: entries.filter(entry => entry.tokenBudgetGuard?.pass === false).length,
    independentCheckFailureRuns: entries.filter(entry => entry.independentCheck && entry.independentCheck.exitCode !== 0).length,
    browserCheckFailureRuns: entries.filter(entry => entry.browserCheck && entry.browserCheck.exitCode !== 0).length,
    protectedFileRegressionRuns: entries.filter(entry => Array.isArray(entry.unexpectedlyChangedFiles) && entry.unexpectedlyChangedFiles.length > 0).length,
    unexpectedFileCreationRuns: entries.filter(entry => Array.isArray(entry.unexpectedlyCreatedFiles) && entry.unexpectedlyCreatedFiles.length > 0).length,
    forbiddenLeakRuns: entries.filter(entry => Array.isArray(entry.forbiddenContentLeaks) && entry.forbiddenContentLeaks.length > 0).length,
  };

  return {
    total: entries.length,
    passed: passed.length,
    failed: entries.length - passed.length,
    passRatePercent: entries.length ? Math.round((passed.length / entries.length) * 100) : 0,
    successfulRuns: passed.length,
    medianDurationMs: percentile(durations, 0.5),
    p95DurationMs: percentile(durations, 0.95),
    medianProviderOrEstimatedTokens: percentile(tokens, 0.5),
    p95ProviderOrEstimatedTokens: percentile(tokens, 0.95),
    medianEstimatedTokensPerWrittenFile: percentile(tokensPerFile, 0.5),
    p95EstimatedTokensPerWrittenFile: percentile(tokensPerFile, 0.95),
    medianToolCalls: percentile(toolCalls, 0.5),
    p95ToolCalls: percentile(toolCalls, 0.95),
    attempted: {
      total: entries.length,
      medianDurationMs: percentile(attemptedDurations, 0.5),
      p95DurationMs: percentile(attemptedDurations, 0.95),
      medianProviderOrEstimatedTokens: percentile(attemptedTokens, 0.5),
      p95ProviderOrEstimatedTokens: percentile(attemptedTokens, 0.95),
      medianModelCalls: percentile(attemptedModelCalls, 0.5),
      p95ModelCalls: percentile(attemptedModelCalls, 0.95),
      tokenAccounting: {
        accountedRuns: attemptedTokenAccounting.filter(value => value.source !== 'unaccounted').length,
        providerReportedRuns: attemptedTokenAccounting.filter(value => value.source === 'provider').length,
        mixedReportedRuns: attemptedTokenAccounting.filter(value => value.source === 'mixed').length,
        estimatedRuns: attemptedTokenAccounting.filter(value => value.source === 'estimate').length,
        zeroCallRuns: attemptedTokenAccounting.filter(value => value.source === 'zero-call').length,
        unaccountedRuns: attemptedTokenAccounting.filter(value => value.source === 'unaccounted').length,
        coveragePercent: entries.length ? Math.round((attemptedTokenAccounting.filter(value => value.source !== 'unaccounted').length / entries.length) * 100) : 100,
      },
    },
    repair: {
      runsWithRepairPhase: repairPhases.filter(phases => phases.length > 0).length,
      repairPhaseCount: repairPhases.reduce((count, phases) => count + phases.length, 0),
      failedAfterRepairCount,
    },
    regressions: regressionRuns,
  };
};
