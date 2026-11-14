import React, { useState } from "react";
import { ArrowDownRight, ArrowRight, ArrowUpRight, Braces, Bug, Check, ChevronDown, CircleAlert, Command, Cpu, Folder, FolderOpen, FolderPlus, GitBranch, Plus, TerminalSquare, Zap } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import type { DashboardViewProps } from "./dashboardTypes.js";
import { QuickConnect } from "./QuickConnect.js";
import { QuillixMark } from "./QuillixMark.js";
import { AmbientOrbs, AmbientParticles, AmbientGrid, ScrollReveal, StaggerChildren } from "./AmbientEffects.js";
import {
  springEntranceVariants,
  slideAndFadeVariants,
  scaleSpringVariants,
  fadeVariants,
  cardHoverVariants,
  ambientGlowPulseVariants,
  staggerContainerFastVariants,
} from "../animations/index.js";

const shortPath = (value: string) => value.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || value;
const recipes = [
  { label: "Build something", detail: "An idea, made real.", icon: Braces, prompt: "I want to build something new. Here is my idea: " },
  { label: "Untangle a bug", detail: "Find the why. Fix the how.", icon: Bug, prompt: "Investigate this bug, explain the root cause, and make a focused fix: " },
  { label: "Check the work", detail: "Tests, not assumptions.", icon: TerminalSquare, prompt: "Run the configured project tests and build. Report actual results and investigate failures." },
];

export function AtlasDashboard(props: DashboardViewProps) {
  const [task, setTask] = useState("");
  const [connectionsOpen, setConnectionsOpen] = useState(false);
  const provider = props.provider || "ollama";
  const names: Record<string, string> = { ollama: "Ollama", sarvam: "Sarvam", openai: "OpenAI", grok: "Grok", groq: "Groq", nvidia: "NVIDIA NIM", universal: "Universal API" };
  const connection = provider === "ollama" ? props.ollama.state === "connected" ? "connected" : props.ollama.state
    : props.offlineMode ? "blocked" : provider === "sarvam" ? props.sarvamConnection : provider === "openai" ? props.openaiConnection : provider === "grok" ? props.grokConnection : provider === "groq" ? props.groqConnection : provider === "nvidia" ? props.nvidiaConnection : props.universalConnection;
  const ready = connection === "connected";
  const status = ready ? "Connection verified" : connection === "blocked" ? "Blocked by offline mode" : connection === "failed" ? "Connection needs attention" : connection === "model-missing" ? "Model not installed" : connection === "disconnected" ? "Ollama disconnected" : connection === "checking" || connection === "unknown" ? "Checking connection" : "Connection not verified";
  const model = props.model || (provider === "ollama" ? props.settings?.model : provider === "groq" ? props.settings?.groqModel : provider === "grok" ? props.settings?.grokModel : provider === "openai" ? props.settings?.openaiModel : provider === "nvidia" ? props.settings?.nvidiaModel : provider === "universal" ? props.settings?.universalModel : "sarvam-105b") || "No model selected";
  const sendToStudio = (prompt: string, label: string) => props.onQuickAction({ id: label, label, description: label, icon: null, prompt });
  return <main className="q-atlas-home relative" aria-label="Workspace overview">
    <AmbientOrbs count={3} theme="gradient" className="absolute inset-0 pointer-events-none" />
    <AmbientParticles count={14} className="absolute inset-0 pointer-events-none" />
    <AmbientGrid size={40} color="var(--border)" className="absolute inset-0 pointer-events-none opacity-40" />
    <div className="q-atlas-page relative z-10">
      <motion.div className="q-atlas-coordinate" variants={slideAndFadeVariants} initial="hidden" animate="visible" custom="right"><span><i /> YOUR SPACE TO MAKE THINGS</span><span>QUILLIX / OVERVIEW</span></motion.div>
      <div className="q-atlas-home-grid">
        <section className="q-atlas-main">
          <motion.div className="q-atlas-intro" variants={springEntranceVariants} initial="hidden" animate="visible">
            <div className="q-atlas-kicker">A CLEAR HEAD. A CAPABLE WORKSPACE.</div>
            <h1>Good ideas.<br />Real <em>software.</em><span className="q-atlas-period">↗</span></h1>
            <p>From the first "what if" to the last passing test.<br className="q-wide-break" /> Your code, your tools, your next move.</p>
          </motion.div>
          <motion.form className="q-atlas-launch" variants={slideAndFadeVariants} initial="hidden" animate="visible" custom="up" style={{ transitionDelay: "0.15s" }} onSubmit={event => { event.preventDefault(); if(task.trim()) sendToStudio(task.trim(), "New coding task"); }}>
            <div className="q-atlas-launch-label"><QuillixMark size={18} /><span>START WITH A THOUGHT</span><span className="q-atlas-editable">Yours to shape</span></div>
            <textarea aria-label="Describe your next task" placeholder="What would you like to bring to life?" value={task} onChange={e => setTask(e.target.value)} rows={2} onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") sendToStudio(task.trim(), "New coding task"); }} />
            <div className="q-atlas-launch-bottom"><span>Ctrl + Enter</span><button type="submit" disabled={!task.trim()} aria-label="Start new task"><ArrowUpRight size={17} /></button></div>
          </motion.form>
          <ScrollReveal>
            <StaggerChildren staggerDelay={0.1} delayChildren={0.1} className="q-atlas-recipes">{recipes.map((recipe, index) => <motion.button key={recipe.label} variants={cardHoverVariants} initial="idle" whileHover="hover" whileTap="tap" onClick={() => sendToStudio(recipe.prompt, recipe.label)}><span className="q-atlas-recipe-no">0{index + 1}</span><recipe.icon size={17} /><span><strong>{recipe.label}</strong><small>{recipe.detail}</small></span><ArrowUpRight size={14} /></motion.button>)}</StaggerChildren>
          </ScrollReveal>
          <ScrollReveal>
            <section className="q-atlas-recent"><div className="q-atlas-section-head"><h2>Pick up the thread.</h2><button onClick={props.onOpenWorkspace}><Plus size={13} /> Open folder</button></div>
              {props.recentWorkspaces.length ? (
                <StaggerChildren staggerDelay={0.08} delayChildren={0.1}>
                  <div className="q-atlas-project-list">{props.recentWorkspaces.slice(0, 4).map((folder, index) => <motion.button key={folder} variants={cardHoverVariants} initial="idle" whileHover="hover" whileTap="tap" onClick={() => props.onSelectRecentWorkspace(folder)}><span className="q-atlas-project-number">{String(index + 1).padStart(2, "0")}</span><Folder size={18} /><span><strong>{shortPath(folder)}</strong><small title={folder}>{folder}</small></span>{folder === props.workspaceRoot && <span className="q-atlas-current">CURRENT</span>}<ArrowUpRight size={15} /></motion.button>)}</div>
                </StaggerChildren>
              ) : (
                <motion.div className="q-atlas-empty-projects" variants={fadeVariants} initial="hidden" animate="visible"><FolderOpen size={21} /><div><strong>A fresh start looks good on you.</strong><p>Open a project folder. Your recent work will live here.</p></div><button onClick={props.onOpenWorkspace} aria-label="Open first workspace"><ArrowRight size={17} /></button></motion.div>
              )}
            </section>
          </ScrollReveal>
        </section>
        <aside className="q-atlas-control" aria-label="Workspace control plane">
          <ScrollReveal direction="left">
            <div className="q-atlas-workspace-card"><div className="q-atlas-paper-top"><span>THE WORKBENCH</span><ArrowDownRight size={22} /></div><div className="q-atlas-folder-art" aria-hidden="true"><Folder size={64} strokeWidth={.8} /><span>Q.</span></div><div className="q-atlas-paper-index">WORKSPACE / {props.workspaceRoot ? "SELECTED" : "NOT SELECTED"}</div><h2>{props.workspaceRoot ? shortPath(props.workspaceRoot) : <>Make room<br />for your next idea.</>}</h2><p title={props.workspaceRoot}>{props.workspaceRoot || "A local folder. A world of possibilities."}</p><button onClick={props.workspaceRoot ? props.onOpenChat : props.onOpenWorkspace}>{props.workspaceRoot ? "Enter the studio" : "Open a workspace"}<ArrowUpRight size={17} /></button><button className="q-atlas-new-project" onClick={props.onCreateProject}><FolderPlus size={13} /> Or start a new project</button></div>
          </ScrollReveal>
          <ScrollReveal direction="left">
            <div className="q-atlas-engine-card"><div className="q-atlas-section-head"><span>THE ENGINE</span><button onClick={props.onOpenSettings} aria-label="Configure coding model"><ArrowUpRight size={14} /></button></div><div className="q-atlas-engine-name"><Cpu size={17} /><strong>{names[provider]}</strong><span>{provider === "ollama" ? "LOCAL" : "CLOUD"}</span></div><code title={model}>{model}</code><div className={`q-atlas-engine-state ${ready ? "q-atlas-connected" : ""}`}><i />{status}</div><div className="q-atlas-engine-foot"><span>{props.offlineMode ? "Offline mode on" : "Offline mode off"}</span>{props.projectMeta?.isGitRepo && <span><GitBranch size={11} />{props.projectMeta.gitBranch || "Git workspace"}</span>}</div></div>
          </ScrollReveal>
          <ScrollReveal direction="left">
            <div className="q-atlas-trace"><div className="q-atlas-section-head"><span>THE LATEST SIGNAL</span><span className="q-atlas-trace-line" /></div>{props.recentActivities.length ? props.recentActivities.slice(-3).reverse().map(item => <div key={item.id} className={`q-atlas-trace-item ${item.type === "error" ? "q-atlas-trace-error" : ""}`}>{item.type === "error" ? <CircleAlert size={13} /> : item.type === "completed" ? <Check size={13} /> : <ArrowRight size={13} />}<span>{item.message}</span></div>) : <p>No task activity yet.<br />The next move is yours.</p>}</div>
          </ScrollReveal>
        </aside>
      </div>
      <details className="q-atlas-connections">
        <summary
          className="flex items-center gap-2 cursor-pointer"
          aria-expanded={connectionsOpen}
          onClick={(e) => {
            e.preventDefault();
            setConnectionsOpen(!connectionsOpen);
          }}
        >
          <span><Cpu size={14} /> Connections & model setup</span>
          <ChevronDown size={15} className={`${connectionsOpen ? "rotate-180" : ""} transition-transform`} aria-hidden="true" />
        </summary>
        <QuickConnect settings={props.settings} onSettingsChanged={props.onSettingsChanged} onConnectionChange={props.onConnectionChange} onRefreshOllama={props.onRefreshOllama} />
      </details>
      <footer className="q-atlas-footer"><span><QuillixMark size={13} /> LESS FRICTION. MORE MAKING.</span><span>YOUR WORKSPACE. YOUR CALL.</span></footer>
    </div>
  </main>;
}
