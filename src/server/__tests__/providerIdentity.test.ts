import {describe,expect,it} from 'vitest';
import {createProviderProfileId} from '../../shared/providerIdentity.js';

describe('provider profile identity',()=>{
  it('uses a valid injected UUID when the runtime provides one',()=>{
    expect(createProviderProfileId(()=> 'provider-test-123')).toBe('provider-test-123');
  });

  it('falls back to a valid local identifier when UUID generation is unavailable',()=>{
    const id=createProviderProfileId(()=>{throw new Error('randomUUID unavailable');});
    expect(id).toMatch(/^[-\w]{1,64}$/);
    expect(id).toMatch(/^provider-/);
  });

  it('rejects malformed injected identifiers without carrying credential data',()=>{
    const id=createProviderProfileId(()=> 'not safe/for a profile id');
    expect(id).toMatch(/^provider-[\w-]+$/);
    expect(id).not.toContain('not safe');
  });
});
