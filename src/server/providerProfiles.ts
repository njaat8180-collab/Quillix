import type {QuillixSettings} from '../shared/types.js';
import type { ProviderConfig, ProviderRequestBudget } from './universal.js';
import { DEFAULT_ONLINE_PROVIDER_MIN_INTERVAL_MS, getEffectiveProviderConcurrency, getEffectiveProviderIntervalMs } from '../shared/providerPacing.js';
/** Endpoint defaults stay at the original budget keys: declared per-minute
 * ceilings are persisted only when a profile sets them, and the runtime treats
 * an absent ceiling exactly like an explicit unlimited one. */
type EndpointRequestBudget = Omit<Required<ProviderRequestBudget>, 'maxRequestsPerMinute' | 'maxTokensPerMinute'>;
const DEFAULT_UNIVERSAL_REQUEST_BUDGET: EndpointRequestBudget = { maxInputChars: 60_000, maxOutputTokens: 4_096, minRequestIntervalMs: DEFAULT_ONLINE_PROVIDER_MIN_INTERVAL_MS, maxConcurrentRequests: 1 };
const NVIDIA_ENDPOINT = 'https://integrate.api.nvidia.com/v1';
const budgetForEndpoint = (endpoint: string): EndpointRequestBudget =>
  endpoint.replace(/\/+$/, '').toLowerCase() === NVIDIA_ENDPOINT
    ? { maxInputChars: 60_000, maxOutputTokens: 8_192, minRequestIntervalMs: DEFAULT_ONLINE_PROVIDER_MIN_INTERVAL_MS, maxConcurrentRequests: 1 }
    : DEFAULT_UNIVERSAL_REQUEST_BUDGET;
function validateUniversalEndpoint(value:string,_protocol:string) {const u=new URL(value);if(u.username||u.password||u.search||u.hash||!(u.protocol==='https:'||(u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname)))) throw new Error('Invalid provider endpoint.');return u.toString().replace(/\/+$/,'');}
export type ProviderProfile = Omit<ProviderConfig,'offlineMode'> & {id:string;name:string};
export function validateProfiles(value:unknown):ProviderProfile[] {
  if(!Array.isArray(value)||value.length>100) throw new Error('Expected at most 100 provider profiles.');
  const ids=new Set<string>();
  return value.map(p=>{
    if(!p||!/^[-\w]{1,64}$/.test(p.id)||ids.has(p.id)) throw new Error('Provider IDs must be unique.');
    ids.add(p.id);
    if(typeof p.name!=='string'||!p.name.trim()||p.name.length>100||typeof p.model!=='string'||!p.model.trim()||p.model.length>200) throw new Error('Provider name and exact model ID required.');
    if(!['openai','responses','anthropic','gemini'].includes(p.protocol)) throw new Error('Unsupported adapter protocol.');
    const endpoint=validateUniversalEndpoint(p.endpoint,p.protocol);
    if(p.auth&&!['none','bearer','basic','header'].includes(p.auth.type)) throw new Error('Invalid authentication type.');
    if(p.auth?.header&&(!/^[a-zA-Z0-9-]+$/.test(p.auth.header)||/^(host|content-type|content-length|connection)$/i.test(p.auth.header))) throw new Error('Invalid authentication header.');
    const out:ProviderProfile={id:p.id,name:p.name.trim(),protocol:p.protocol,endpoint,model:p.model.trim()};
    if(p.auth) out.auth={type:p.auth.type,...(p.auth.header?{header:p.auth.header}:{})};
    if(p.reasoningEffort!==undefined) {if(!['none','low','high','max'].includes(p.reasoningEffort)) throw new Error('Invalid reasoning effort.');out.reasoningEffort=p.reasoningEffort;}
    if(p.capabilities) {for(const key of ['tools','streaming','reasoning']) if(typeof p.capabilities[key]!=='boolean') throw new Error('Capabilities must be booleans.');out.capabilities={tools:p.capabilities.tools,streaming:p.capabilities.streaming,reasoning:p.capabilities.reasoning};}
    else out.capabilities={tools:false,streaming:true,reasoning:false};
    if (p.requestBudget !== undefined) {
      if (!p.requestBudget || typeof p.requestBudget !== 'object' || Array.isArray(p.requestBudget)) throw new Error('Invalid provider request budget.');
      const budget: Record<string, number> = {};
      for (const key of ['maxInputChars', 'maxOutputTokens', 'minRequestIntervalMs', 'maxRequestsPerMinute', 'maxTokensPerMinute'] as const) {
        if (p.requestBudget[key] !== undefined) {
          const value = p.requestBudget[key];
          if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error(`Invalid provider budget: ${key}.`);
          budget[key] = Math.round(value);
        }
      }
      if (!Object.keys(budget).length) throw new Error('Provider request budget must define a limit or pacing value.');
      out.requestBudget = { ...budgetForEndpoint(endpoint), ...budget };
    }
    for(const key of ['inputCostPerMillion','outputCostPerMillion','reasoningBudget'] as const) if(p[key]!==undefined) {if(typeof p[key]!=='number'||!Number.isFinite(p[key])||p[key]<0) throw new Error('Invalid price or reasoning budget.');out[key]=p[key];}
    return out;
  });
}
export function selectedProviderConfig(s:QuillixSettings):ProviderConfig {
  const profile=s.providerProfiles?.find(p=>p.id===s.activeProviderProfile);
  const effectiveInterval = getEffectiveProviderIntervalMs({ turboSpeedMode: s.turboSpeedMode, performanceMode: s.performanceMode, overdriveMode: s.overdriveMode });
  const effectiveConcurrency = getEffectiveProviderConcurrency({ turboSpeedMode: s.turboSpeedMode, performanceMode: s.performanceMode, overdriveMode: s.overdriveMode });
  // Turbo is a global latency preference. A saved profile's conservative
  // spacing must not silently put the old delay back after Turbo selected its
  // 1000ms floor. RPM/TPM ceilings and Retry-After pacing remain enforced.
  // Overdrive goes further: no spacing at all, no declared rolling-quota
  // wait — only the provider's own limits remain (see universal.ts).
  return profile
    ? { ...profile, offlineMode: s.offlineMode, overdriveMode: s.overdriveMode === true, promptCache: s.promptCache === true, requestBudget: { ...budgetForEndpoint(profile.endpoint), ...(profile.requestBudget || {}), minRequestIntervalMs: s.turboSpeedMode === true || s.overdriveMode === true ? effectiveInterval : (profile.requestBudget?.minRequestIntervalMs ?? effectiveInterval), maxConcurrentRequests: effectiveConcurrency } }
    : { protocol:s.universalProtocol||'openai', endpoint:s.universalEndpoint||'', model:s.universalModel||'', offlineMode:s.offlineMode, overdriveMode: s.overdriveMode === true, promptCache: s.promptCache === true, requestBudget: { ...budgetForEndpoint(s.universalEndpoint||''), minRequestIntervalMs: effectiveInterval, maxConcurrentRequests: effectiveConcurrency } };
}
