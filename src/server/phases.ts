import type { AgentPhase } from '../shared/types.js';
import { isSingleFileCreationRequest } from './projectContract.js';

/**
 * NUVRO AI Phase System
 *
 * Each coding request gets a task-specific workflow. The phase count and
 * descriptions depend on the requested deliverables, and repair/retest steps
 * appear only after an observed failure. Tool-driven phases never advance
 * merely because time or model turns passed.
 */

export type PhaseCategory =
  | 'understand'
  | 'inspect'
  | 'plan'
  | 'structure'
  | 'write'
  | 'command'
  | 'validate'
  | 'build'
  | 'test'
  | 'fix'
  | 'verify'
  | 'report';

export interface PhaseDefinition {
  id: string;
  title: string;
  /** Which real operation categories advance this phase. */
  categories: PhaseCategory[];
}

/** Request archetypes produced by the intent classifier. */
export type RequestKind = 'project' | 'fix' | 'analyze';

/** Detects what kind of request this is from the prompt text. */
export function classifyRequestKind(prompt: string): RequestKind {
  const text = (prompt || '').toLowerCase();
  if (isSingleFileCreationRequest(prompt)) return 'project';
  if ((/\b(?:fix|repair|correct)\b/.test(text) || /(?:ठीक|फिक्स|सुधार)/.test(text)) &&
      /\.(?:[cm]?[jt]sx?|py|go|rs|java|cs|cpp|c|html?|css|vue|svelte|rb|php)\b/i.test(text)) return 'fix';
  const creating =
    // Be tolerant of common chat typos such as "creeate" and "harnase";
    // a coding request must enter the tool workflow even when spelling is
    // imperfect. The technology-stack signal prevents plain conversation
    // from being treated as a project unless an action verb is also present.
    (/\b(cre+ate|build|make|generate|scaffold|set\s?up|initialize|develop|write|design)\b/.test(text) || /(बना|बनाओ|बनाना|बनाइए|तैयार|डेवलप)/.test(text)) &&
    (/\b(project|app|application|website|web\s?app|page|site|game|api|server|cli|tool|tools|program|platform|portfolio|landing|blog|shop|store|dashboard|calculator|to-?do|todo|module|script|library|component|form|widget|extension|plugin|utility|utilities|generator|tracker|notes?\s?app|harness|harnase|html|css|javascript|js|typescript|react|python|py|java|kotlin|swift|rust|golang|go|c\+\+|cpp|csharp|cs|ruby|rb|php|node(?:\.js)?)\b/.test(text) || /(प्रोजेक्ट|वेबसाइट|साइट|ऐप|गेम|टूल|पेज|स्क्रिप्ट|कैलकुलेटर|लिस्ट)/.test(text));
  const fixing =
    (/\b(fix|repair|resolve|debug|patch|correct)\b/.test(text) || /(ठीक|सुधार|फिक्स|डिबग)/.test(text)) &&
    (/\b(bug|error|issue|fail(ure|ing|ed)?|crash|exception|traceback|broken|test)\b/.test(text) || /(गलती|बग|एरर|टेस्ट|क्रैश|समस्या)/.test(text));
  if (creating) return 'project';
  if (fixing) return 'fix';
  // Existing-project implementation work uses the same edit/verify workflow
  // as repairs, instead of being mislabeled as read-only analysis.
  if (/\b(refactor|optimi[sz]e|implement|modify|rename|migrate|add|update|upgrade|improve|edit|change|remove|connect|link|wire|integrate|combine|merge|attach|join|style)\b/i.test(text) ||
      /(?:बदल|जोड़|मिलाओ|कनेक्ट|लिंक|रिफैक्टर|अपडेट|हटाओ|स्टाइल|लगा|लगाओ|डाल|डालो|रखो|रख|बना दो|जोड़ दो)/.test(text)) return 'fix';
  return 'analyze';
}

const PROJECT_PHASES: PhaseDefinition[] = [
  { id: 'understand', title: 'Understand Requirements', categories: ['understand'] },
  { id: 'inspect', title: 'Inspect Workspace', categories: ['inspect'] },
  { id: 'plan', title: 'Architecture & Project Planning', categories: ['plan'] },
  { id: 'structure', title: 'Create Project Structure', categories: ['structure'] },
  { id: 'implement-core', title: 'Core Implementation', categories: ['write'] },
  { id: 'implement-features', title: 'UI / Feature Implementation', categories: ['write'] },
  { id: 'integration', title: 'Integration', categories: ['write', 'command'] },
  { id: 'validation', title: 'Validation', categories: ['validate'] },
  { id: 'build', title: 'Build / Run', categories: ['build'] },
  { id: 'testing', title: 'Testing', categories: ['test'] },
  { id: 'error-analysis', title: 'Error Analysis', categories: [] },
  { id: 'fixes', title: 'Fixes', categories: ['fix'] },
  { id: 'retesting', title: 'Retesting', categories: ['test'] },
  { id: 'final-verification', title: 'Final Verification', categories: ['verify'] },
  { id: 'completion', title: 'Completion Report', categories: ['report'] },
];

const FIX_PHASES: PhaseDefinition[] = [
  { id: 'understand', title: 'Understand the Problem', categories: ['understand'] },
  { id: 'inspect', title: 'Inspect Workspace', categories: ['inspect'] },
  { id: 'diagnose', title: 'Diagnose Root Cause', categories: ['inspect', 'plan'] },
  { id: 'locate', title: 'Locate Relevant Source', categories: ['inspect'] },
  { id: 'plan', title: 'Plan the Fix', categories: ['plan'] },
  { id: 'apply', title: 'Apply the Fix', categories: ['write'] },
  { id: 'validate', title: 'Validate Changes', categories: ['validate', 'build'] },
  { id: 'testing', title: 'Run Tests', categories: ['test'] },
  { id: 'retest', title: 'Retest After Fix', categories: ['test'] },
  { id: 'report', title: 'Final Report', categories: ['report'] },
];

const ANALYZE_PHASES: PhaseDefinition[] = [
  { id: 'understand', title: 'Understand the Request', categories: ['understand'] },
  { id: 'inspect', title: 'Inspect Workspace', categories: ['inspect'] },
  { id: 'scan', title: 'Scan Project Structure', categories: ['inspect'] },
  { id: 'analyze', title: 'Analyze Code & Dependencies', categories: ['inspect', 'plan'] },
  { id: 'cross-check', title: 'Cross-Check Findings', categories: ['inspect'] },
  { id: 'validate', title: 'Validate Findings', categories: ['validate'] },
  { id: 'testing', title: 'Run Tests / Checks', categories: ['test'] },
  { id: 'fixes', title: 'Apply Requested Changes', categories: ['write', 'fix'] },
  { id: 'retesting', title: 'Verify Changes', categories: ['verify'] },
  { id: 'report', title: 'Final Report', categories: ['report'] },
];

/**
 * Request-scoped workflow, assembled from actual deliverables rather than a
 * fixed 10–15-step script. Conditional repair steps appear only on failures.
 * The old archetype-only API remains for historical records and tests.
 */
export function adaptivePhaseDefinitions(kind: RequestKind, prompt: string): PhaseDefinition[] {
  const text = prompt.toLowerCase();
  const explicitTests = /\b(test|tests|spec|coverage|unit|integration|e2e|vitest|jest|pytest|check)\b/i.test(text);
  const expectsExecution = /\b(run|launch|execute|start|compile|build|preview|deploy)\b/i.test(text);
  const uiFeatures = /\b(ui|frontend|web|page|website|app|application|game|responsive|component|form|tasks?|features?|dashboard|calculator|to-?do)\b/i.test(text);
  const fileNames = [...new Set(Array.from(prompt.matchAll(/(?:^|[^\w./-])([\w.-]+\.(?:html?|css|[cm]?js|tsx?|jsx|py|json|md|go|rs|java|cpp|c|cs|php|rb))(?![\w.-])/gi))
    .map(m => m[1]))].slice(0, 6);
  const description = fileNames.length ? `Write ${fileNames.join(', ')}` : 'Write requested project source';
  const specificFeature = /\bto-?do|\btasks?\b/i.test(text)
    ? 'Implement task actions and persistence'
    : /\bcalculator\b/i.test(text)
      ? 'Implement calculator interactions'
      : 'Implement requested behaviors';
  if (kind === 'project') {
    const phases: PhaseDefinition[] = [
      { id: 'understand', title: 'Understand requested deliverables', categories: ['understand'] },
      { id: 'inspect', title: 'Inspect target workspace', categories: ['inspect'] },
      { id: 'structure', title: 'Create project location', categories: ['structure'] },
      { id: 'implement-core', title: description, categories: ['write'] },
    ];
    if (uiFeatures) phases.push({ id: 'implement-features', title: specificFeature, categories: ['write'] });
    phases.push({ id: 'validation', title: 'Validate actual files and references', categories: ['validate'] });
    if (expectsExecution) phases.push({ id: 'build', title: 'Run or preview project', categories: ['build'] });
    if (explicitTests || uiFeatures) phases.push({ id: 'testing', title: 'Check requested functionality', categories: ['test'] });
    phases.push({ id: 'final-verification', title: 'Verify deliverables against request', categories: ['verify'] });
    phases.push({ id: 'completion', title: 'Report verified outcome', categories: ['report'] });
    return phases;
  }
  if (kind === 'fix') {
    const phases: PhaseDefinition[] = [
      { id: 'understand', title: 'Understand reported failure', categories: ['understand'] },
      { id: 'inspect', title: 'Inspect failing source and evidence', categories: ['inspect'] },
      { id: 'diagnose', title: 'Identify root cause', categories: ['inspect', 'plan'] },
      { id: 'apply', title: 'Apply targeted repair', categories: ['write'] },
      { id: 'validate', title: 'Validate changed files', categories: ['validate'] },
    ];
    if (explicitTests || expectsExecution) phases.push({ id: 'testing', title: 'Reproduce and retest', categories: ['test'] });
    phases.push({ id: 'report', title: 'Report evidence and remaining risks', categories: ['report'] });
    return phases;
  }
  const phases: PhaseDefinition[] = [
    { id: 'understand', title: 'Understand the question', categories: ['understand'] },
    { id: 'inspect', title: 'Inspect relevant workspace context', categories: ['inspect'] },
    { id: 'analyze', title: 'Analyze relevant code', categories: ['inspect', 'plan'] },
  ];
  if (explicitTests) phases.push({ id: 'testing', title: 'Run requested checks', categories: ['test'] });
  phases.push({ id: 'report', title: 'Report evidence and uncertainty', categories: ['report'] });
  return phases;
}

/** Builds the initial phase list (all pending) for a request kind. */
export function buildPhasePlan(kind: RequestKind, prompt?: string): AgentPhase[] {
  const defs = prompt === undefined ? (kind === 'project' ? PROJECT_PHASES : kind === 'fix' ? FIX_PHASES : ANALYZE_PHASES) : adaptivePhaseDefinitions(kind, prompt);
  return defs.map((d) => ({ id: d.id, title: d.title, status: 'pending' as const }));
}

/**
 * Stateful tracker that advances phases only when real operations occur.
 * `observe(category, detail)` is called by the engine after every executed
 * tool / verification step.
 */
export class PhaseTracker {
  private phases: AgentPhase[];
  private defs: PhaseDefinition[];
  private adaptive: boolean;
  private currentIdx = -1;
  /** Categories whose real work has actually been observed. */
  private observed = new Set<PhaseCategory>();
  private counts = new Map<PhaseCategory, number>();

  constructor(kind: RequestKind, prompt?: string) {
    this.adaptive = prompt !== undefined;
    this.defs = prompt === undefined
      ? (kind === 'project' ? PROJECT_PHASES : kind === 'fix' ? FIX_PHASES : ANALYZE_PHASES)
      : adaptivePhaseDefinitions(kind, prompt);
    this.phases = this.defs.map(d => ({ id: d.id, title: d.title, status: 'pending' as const }));
  }

  /** Insert a repair milestone only once a real failure has happened. */
  public activateRepairFlow(): void {
    if (!this.adaptive) return;
    const existing = new Set(this.defs.map(p => p.id));
    const repair: PhaseDefinition[] = ([
      { id: 'error-analysis', title: 'Analyze failure details', categories: ['inspect', 'plan'] },
      { id: 'fixes', title: 'Repair failing operation', categories: ['fix', 'write'] },
      { id: 'retesting', title: 'Rerun failing verification', categories: ['test'] },
    ] as PhaseDefinition[]).filter(p => !existing.has(p.id));
    if (!repair.length) return;
    const insertAt = Math.max(0, this.defs.findIndex(p => p.id === 'final-verification' || p.id === 'report'));
    const index = insertAt === 0 ? this.defs.length : insertAt;
    this.defs.splice(index, 0, ...repair);
    this.phases.splice(index, 0, ...repair.map(d => ({ id: d.id, title: d.title, status: 'pending' as const })));
    if (this.currentIdx >= index) this.currentIdx += repair.length;
  }

  public getPhases(): AgentPhase[] {
    return this.phases.map((p) => ({ ...p }));
  }

  public get currentIndex(): number {
    return this.currentIdx;
  }

  /**
   * Records that REAL work of a category happened (an actual tool execution)
   * and advances the phase list accordingly. Repeated observations of the
   * same category walk forward through the phases that share that category:
   * the first create_file starts "Core Implementation", the next one
   * completes it and moves on to the next implementation phase.
   */
  public observe(category: PhaseCategory, detail?: string): void {
    this.observed.add(category);
    this.counts.set(category, (this.counts.get(category) || 0) + 1);

    // Only the first unfinished phase that explicitly accepts this category
    // may be advanced. We never scan ahead and mark a later phase merely
    // because it happens to share the same broad category. Milestone phases
    // that need semantic knowledge (for example integration/final verification)
    // are completed explicitly by AgentEngine.
    const idx = this.findIndexMatching(category, Math.max(0, this.currentIdx + 1));
    if (idx === -1) return;

    if (this.adaptive) {
      // Observations mark started work only; completion requires an explicit
      // successful operation or a verified milestone, never position/order.
      const phase = this.phases[idx];
      if (phase.status === 'pending') {
        this.phases[idx] = { ...phase, status: 'in_progress', detail: detail || phase.detail };
      }
      this.currentIdx = Math.max(this.currentIdx, idx);
      return;
    }

    // Moving forward to `idx` means every phase between the previously active
    // one and `idx` is now behind us. Whatever was still in progress really
    // did finish (its category simply doesn't match anymore), and anything
    // that never started was genuinely never touched, so it is honestly
    // reported as skipped rather than silently left pending.
    for (let i = Math.max(this.currentIdx, 0); i < idx; i++) {
      const prior = this.phases[i];
      if (prior.status === 'in_progress') {
        this.phases[i] = { ...prior, status: 'completed' };
      } else if (prior.status === 'pending') {
        this.phases[i] = { ...prior, status: 'skipped' };
      }
    }

    const phase = this.phases[idx];
    if (phase.status === 'pending') {
      this.phases[idx] = { ...phase, status: 'in_progress', detail: detail || phase.detail };
    }
    this.currentIdx = Math.max(this.currentIdx, idx);
  }

  private findIndexMatching(category: PhaseCategory, from = 0): number {
    for (let i = from; i < this.defs.length; i++) {
      if (this.defs[i].categories.includes(category) && this.phases[i].status !== 'completed') {
        return i;
      }
    }
    return -1;
  }

  /** Explicitly complete a phase by id (used when an operation finishes). */
  public complete(phaseId: string, detail?: string): void {
    const idx = this.phases.findIndex((p) => p.id === phaseId);
    if (idx === -1) return;
    this.phases[idx] = { ...this.phases[idx], status: 'completed', detail: detail || this.phases[idx].detail };
  }

  public fail(phaseId: string, detail: string): void {
    const idx = this.phases.findIndex((p) => p.id === phaseId);
    if (idx === -1) return;
    this.phases[idx] = { ...this.phases[idx], status: 'failed', detail };
    if (this.currentIdx < idx) this.currentIdx = idx;
  }

  /** Marks an optional phase as intentionally not applicable to this request. */
  public skip(phaseId: string, detail: string): void {
    const idx = this.phases.findIndex((p) => p.id === phaseId);
    if (idx === -1) return;
    this.phases[idx] = { ...this.phases[idx], status: 'skipped', detail };
  }

  /** Resolve an earlier failed attempt after a later repair passes verification. */
  public recoverFailures(detail = 'Recovered by a later verified repair'): void {
    this.phases = this.phases.map((phase) => phase.status === 'failed'
      ? { ...phase, status: 'completed', detail: `${detail}: ${phase.detail || 'earlier attempt failed'}` }
      : phase);
  }

  /** Marks in_progress phases completed (their work finished). */
  public settleInProgress(): void {
    for (let i = 0; i < this.phases.length; i++) {
      if (this.phases[i].status === 'in_progress') {
        this.phases[i] = { ...this.phases[i], status: 'completed' };
      }
    }
  }

  /**
   * Final pass at the end of a run: any phase that never saw its real work is
   * marked 'skipped' (honestly reported, never faked), and the final report
   * phase is completed.
   */
  public finalize(success: boolean): AgentPhase[] {
    if (this.adaptive) {
      // If a real phase failed, later phases were never reached; showing all
      // of them as failed creates a misleading cascade in the UI. Keep the
      // first real failure red and mark the rest as skipped/not reached.
      const hasFailure = this.phases.some((p) => p.status === 'failed');
      this.phases = this.phases.map(p => {
        if (p.status === 'pending') {
          if (hasFailure) return { ...p, status: 'skipped', detail: p.detail || 'Not reached because an earlier phase failed' };
          return success
            ? { ...p, status: 'skipped', detail: p.detail || 'Not required by this request' }
            : { ...p, status: 'failed', detail: p.detail || 'Required work was not verified before the run ended' };
        }
        // An in-progress phase has observed real work. On a clean run it is
        // honest to close that observed operation; on a failed run, leave it
        // as not reached unless the engine explicitly failed it.
        if (p.status === 'in_progress' && !hasFailure) {
          return { ...p, status: 'completed', detail: p.detail || 'Observed operation completed with the run' };
        }
        if (p.status === 'in_progress' && hasFailure) {
          return { ...p, status: 'skipped', detail: p.detail || 'Not reached because an earlier phase failed' };
        }
        return p;
      });
      const last = this.phases[this.phases.length - 1];
      if (last && last.status === 'pending' && !hasFailure) {
        last.status = success ? 'skipped' : 'failed';
        last.detail = last.detail || (success ? 'Not required by this request' : 'Required completion was not verified');
      }
      return this.getPhases();
    }
    // Never turn required project work into "not needed". By the time this
    // runs, the engine has already explicitly completed/failed every
    // milestone that this specific request actually required. Anything still
    // 'in_progress' really did finish (or die) with the run as a whole, and
    // anything still 'pending' genuinely never happened: on a successful run
    // that's an honest "skipped" (optional work this request didn't need),
    // on a failed run it's an honest "failed" (required work that never got
    // the chance to run).
    for (let i = 0; i < this.phases.length; i++) {
      const status = this.phases[i].status;
      if (status === 'in_progress') {
        this.phases[i] = { ...this.phases[i], status: success ? 'completed' : 'failed' };
      } else if (status === 'pending') {
        this.phases[i] = { ...this.phases[i], status: success ? 'skipped' : 'failed' };
      }
    }
    const last = this.phases[this.phases.length - 1];
    if (last) last.status = success ? 'completed' : 'failed';
    return this.getPhases();
  }

  /**
   * Marks every pending/in_progress phase as FAILED with the given detail.
   * Used when a run ends without doing its required work (e.g. a project
   * request where nothing was built) so the report never claims "(not
   * needed)" for phases the task genuinely required.
   */
  public failAllRemaining(detail: string): void {
    // Purely cognitive phases (understanding the request, inspecting the
    // workspace, planning) genuinely happened even when the run ultimately
    // produced nothing, so they are left as real "completed" work. Everything
    // else — anything structural or deliverable — is honestly FAILED: a
    // half-finished "Create Project Structure" (an empty folder, say) is not
    // a real success just because it ran before the request as a whole fell
    // apart, so it must not be left showing as completed either.
    const cognitiveOnly: PhaseCategory[] = ['understand', 'inspect', 'plan'];
    for (let i = 0; i < this.phases.length; i++) {
      const status = this.phases[i].status;
      // A completed phase is evidence of real work and must never be changed
      // to failed merely because a later phase failed. The old behavior made
      // one provider/tool error appear as a cascade of unrelated failures.
      if (status === 'completed' || status === 'skipped') continue;
      if (status === 'failed') continue;
      const categories = this.defs[i].categories;
      const isCognitiveOnly = categories.length > 0 && categories.every((c) => cognitiveOnly.includes(c));
      if (isCognitiveOnly) continue;
      const firstUnresolved = this.phases.findIndex((p) => p.status === 'pending' || p.status === 'in_progress');
      this.phases[i] = i === firstUnresolved
        ? { ...this.phases[i], status: 'failed', detail }
        : { ...this.phases[i], status: 'skipped', detail: 'Not reached because an earlier phase failed' };
    }
    if (this.currentIdx < this.phases.length - 1) this.currentIdx = this.phases.length - 1;
  }

  /** Progress ratio 0..1 based on completed phases. */
  public progress(): number {
    if (this.phases.length === 0) return 0;
    const done = this.phases.filter((p) => p.status === 'completed' || p.status === 'skipped').length;
    return done / this.phases.length;
  }
}

/** Maps a tool name to the phase category its real execution advances. */
export function toolCategory(toolName: string): PhaseCategory | null {
  switch (toolName) {
    case 'read_file':
    case 'list_directory':
    case 'get_file_metadata':
    case 'get_project_structure':
    case 'compare_files':
    case 'verify_file':
    case 'search_files':
    case 'search_code':
    case 'find_symbol':
    case 'find_references':
    case 'find_definition':
    case 'find_usages':
    case 'analyze_file':
    case 'analyze_project':
    case 'detect_project':
    case 'detect_framework':
    case 'detect_project_type':
    case 'git_status':
    case 'git_log':
    case 'git_branch':
      return 'inspect';
    case 'create_directory':
      return 'structure';
    case 'create_file':
    case 'write_file':
    case 'write_file_chunk':
    case 'append_file':
    case 'edit_file':
    case 'apply_patch':
    case 'rename_file':
    case 'move_file':
    case 'copy_file':
      return 'write';
    case 'run_command':
      return 'command';
    case 'run_build':
      return 'build';
    case 'run_tests':
      return 'test';
    case 'run_linter':
    case 'project_health_check':
      return 'validate';
    case 'delete_file':
      return 'write';
    case 'git_add':
    case 'git_commit':
    case 'git_restore':
      return 'command';
    default:
      return null;
  }
}
