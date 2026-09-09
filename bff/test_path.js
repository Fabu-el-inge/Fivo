const path = require('path');
const { execFile } = require('child_process');

const isWindows = process.platform === 'win32';
const CLI_PATH = path.resolve(__dirname, '../build/bin/fivo_demo' + (isWindows ? '.exe' : '')).replace(/\\/g, '/');

console.log('CLI_PATH:', CLI_PATH);
console.log('File exists:', require('fs').existsSync(CLI_PATH));

execFile(CLI_PATH, ['--context', 'C', '--style', 'pop'], { timeout: 5000 }, (err, stdout, stderr) => {
    console.log('Error:', err);
    console.log('Stdout:', stdout);
    console.log('Stderr:', stderr);
});
