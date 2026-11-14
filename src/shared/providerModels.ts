export interface ProviderModelEntry {
  id: string;
  name?: string;
  tools?: boolean;
  contextLength?: number;
  streaming?: boolean;
  reasoning?: boolean;
}

/** Show unknown metadata explicitly so a bare model ID is not mistaken for a
 * verified coding/tool-capability declaration.
 */
export function formatProviderModelLabel(model: ProviderModelEntry): string {
  const identity = model.name ? `${model.name} (${model.id})` : model.id;
  const reportedFeatureFlags = [model.tools, model.streaming, model.reasoning].filter(value => typeof value === 'boolean').length;
  const capabilities = [
    model.tools === true ? 'tools' : model.tools === false ? 'no tools' : '',
    model.streaming === true ? 'streaming' : model.streaming === false ? 'no streaming' : '',
    model.reasoning === true ? 'reasoning' : '',
    model.reasoning === false ? 'no reasoning' : '',
    reportedFeatureFlags === 0 ? 'capabilities unknown' : reportedFeatureFlags < 3 ? `${3 - reportedFeatureFlags} capability flags unknown` : '',
    model.contextLength ? `${Math.round(model.contextLength / 1000)}k context` : '',
  ].filter(Boolean);
  return capabilities.length ? `${identity} · ${capabilities.join(' · ')}` : identity;
}
