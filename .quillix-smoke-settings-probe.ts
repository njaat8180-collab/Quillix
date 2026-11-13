import { SettingsStore, DEFAULT_SETTINGS } from './src/server/settings.ts';
const s=new SettingsStore(process.argv[2]);
const x=s.update({...DEFAULT_SETTINGS,aiProvider:'openai',offlineMode:false});
console.log(JSON.stringify({success:x.success,error:x.error,provider:s.get().aiProvider,offline:s.get().offlineMode},null,2));
