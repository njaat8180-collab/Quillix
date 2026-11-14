// Checks the actual Windows user encryption context using a synthetic string.
// No user API key is needed and no files are created by this command.
import { checkWindowsSarvamStorage } from '../src/server/sarvam.ts';
const status = checkWindowsSarvamStorage();
console.log(status.ok ? 'PASS:' : 'FAIL:', status.message);
if (!status.ok) process.exitCode = 1;
