import {describe,it,expect} from 'vitest';
import {validateProfiles,selectedProviderConfig} from '../providerProfiles.js';
const base={id:'p1',name:'Profile One',protocol:'openai' as const,endpoint:'https://api.example.com/v1',model:'vendor/model'};
describe('provider profile budget validation',()=>{
  it('accepts declared per-minute request and token ceilings',()=>{
    const [profile]=validateProfiles([{...base,requestBudget:{maxRequestsPerMinute:12,maxTokensPerMinute:90_000}}]);
    expect(profile.requestBudget?.maxRequestsPerMinute).toBe(12);
    expect(profile.requestBudget?.maxTokensPerMinute).toBe(90_000);
  });
  it('rounds fractional ceilings',()=>{
    const [profile]=validateProfiles([{...base,requestBudget:{maxRequestsPerMinute:10.6,maxTokensPerMinute:1500.4}}]);
    expect(profile.requestBudget?.maxRequestsPerMinute).toBe(11);
    expect(profile.requestBudget?.maxTokensPerMinute).toBe(1_500);
  });
  it('accepts zero as an explicit no-ceiling declaration',()=>{
    const [profile]=validateProfiles([{...base,requestBudget:{maxRequestsPerMinute:0,maxTokensPerMinute:0}}]);
    expect(profile.requestBudget?.maxRequestsPerMinute).toBe(0);
    expect(profile.requestBudget?.maxTokensPerMinute).toBe(0);
  });
  it('rejects non-numeric, negative, or non-finite ceilings',()=>{
    for(const bad of ['lots',-1,Number.NaN,Number.POSITIVE_INFINITY,{}]) {
      expect(()=>validateProfiles([{...base,requestBudget:{maxRequestsPerMinute:bad as never}}]),`maxRequestsPerMinute=${String(bad)}`).toThrow(/Invalid provider budget: maxRequestsPerMinute/);
      expect(()=>validateProfiles([{...base,requestBudget:{maxTokensPerMinute:bad as never}}]),`maxTokensPerMinute=${String(bad)}`).toThrow(/Invalid provider budget: maxTokensPerMinute/);
    }
  });
  it('merges declared ceilings over endpoint defaults',()=>{
    const [profile]=validateProfiles([{...base,endpoint:'https://integrate.api.nvidia.com/v1/',requestBudget:{maxRequestsPerMinute:5}}]);
    expect(profile.requestBudget?.maxOutputTokens).toBe(8_192);
    expect(profile.requestBudget?.maxRequestsPerMinute).toBe(5);
    expect(profile.requestBudget?.maxTokensPerMinute).toBeUndefined();
  });
  it('keeps existing budget validation intact',()=>{
    expect(()=>validateProfiles([{...base,requestBudget:{}}])).toThrow(/limit or pacing value/);
    expect(()=>validateProfiles([{...base,requestBudget:[] as never}])).toThrow(/Invalid provider request budget/);
    expect(()=>validateProfiles([{...base,requestBudget:{minRequestIntervalMs:-5}}])).toThrow(/Invalid provider budget: minRequestIntervalMs/);
    const [profile]=validateProfiles([{...base,requestBudget:{maxInputChars:1_000,minRequestIntervalMs:2_500}}]);
    expect(profile.requestBudget?.maxInputChars).toBe(1_000);
    expect(profile.requestBudget?.minRequestIntervalMs).toBe(2_500);
    expect(profile.requestBudget?.maxRequestsPerMinute).toBeUndefined();
    expect(profile.requestBudget?.maxTokensPerMinute).toBeUndefined();
  });
  it('defaults legacy profiles without a budget to no declared ceilings',()=>{
    const [profile]=validateProfiles([{...base}]);
    expect(profile.requestBudget).toBeUndefined();
  });
  it('leaves the legacy single-provider path undeclared (absent means unlimited)',()=>{
    const config=selectedProviderConfig({universalEndpoint:'https://legacy.example/v1',universalProtocol:'openai',universalModel:'vendor/model',offlineMode:false} as never);
    expect(config.requestBudget?.maxRequestsPerMinute).toBeUndefined();
    expect(config.requestBudget?.maxTokensPerMinute).toBeUndefined();
  });
  it('carries profile ceilings into the selected provider config',()=>{
    const config=selectedProviderConfig({universalEndpoint:'https://legacy.example/v1',universalProtocol:'openai',universalModel:'vendor/model',offlineMode:false,providerProfiles:[{...base,requestBudget:{maxRequestsPerMinute:7,maxTokensPerMinute:40_000}}],activeProviderProfile:'p1'} as never);
    expect(config.requestBudget?.maxRequestsPerMinute).toBe(7);
    expect(config.requestBudget?.maxTokensPerMinute).toBe(40_000);
  });
});
