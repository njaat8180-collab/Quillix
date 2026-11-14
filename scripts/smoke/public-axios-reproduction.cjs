// Native reproduction of SWE-bench Multilingual axios__axios-4731.
// This checks the published issue's behavior. Official container grading is separate.
const fs = require('node:fs');
const path = require('node:path');
const {createRequire} = require('node:module');
const http = require('node:http');
const root = fs.realpathSync(process.argv[2]);
const repoRequire = createRequire(path.join(root, 'package.json'));
if (repoRequire('./package.json').name !== 'axios') throw new Error('Expected the Axios task checkout');
const axios = repoRequire('./index.js');
async function verify() {
  const server = http.createServer((request, response) => {
    let bytes = 0;
    request.on('data', chunk => { bytes += chunk.length; });
    request.on('end', () => { response.end(String(bytes)); });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const url = 'http://127.0.0.1:' + server.address().port + '/upload';
  const large = Buffer.alloc(11 * 1024 * 1024, 'x');
  const cases = [
    {name: 'default body limit is unlimited', config: {}, body: large},
    {name: 'explicit negative body limit is unlimited', config: {maxBodyLength: -1}, body: large},
    {name: 'explicit Infinity remains unlimited', config: {maxBodyLength: Infinity}, body: large},
    {name: 'no redirects has the same unlimited default', config: {maxRedirects: 0}, body: large},
    {name: 'positive body limit is enforced', config: {maxBodyLength: 1024}, body: Buffer.alloc(2048), reject: true},
  ];
  const results = [];
  try {
    for (const test of cases) {
      try {
        const result = await axios.post(url, test.body, {timeout: 4000, proxy: false, ...test.config});
        results.push({name: test.name, passed: !test.reject && Number(result.data) === test.body.length});
      } catch (error) {
        results.push({name: test.name, passed: !!test.reject && /maxBodyLength/.test(error.message), error: error.message});
      }
    }
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
  const passed = results.every(result => result.passed);
  console.log(JSON.stringify({instanceId: 'axios__axios-4731', grading: 'native issue reproduction', status: passed ? 'PASS' : 'FAIL', results}));
  process.exitCode = passed ? 0 : 1;
}
verify().catch(error => {console.error(String(error)); process.exitCode = 1;});
