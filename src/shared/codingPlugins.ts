export interface CodingPlugin {
  id: string;
  name: string;
  description: string;
  source: 'bundled' | 'built-in';
  offline: boolean;
  enabled: boolean;
  manageable: boolean;
  tools: string[];
  packages?: string[];
  documentation?: string;
}
