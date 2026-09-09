const express = require('express');
const { execFile } = require('child_process');
const path = require('path');

const app = express();

const isWindows = process.platform === 'win32';
const CLI_PATH = path.resolve(__dirname, '../build/bin/fivo_demo' + (isWindows ? '.exe' : '')).replace(/\\/g, '/');

console.log('CLI_PATH:', CLI_PATH);
console.log('Exists:', require('fs').existsSync(CLI_PATH));

app.get('/test', (req, res) => {
    console.log('Request received');

    execFile(CLI_PATH, ['--context', 'C', '--style', 'pop'], { timeout: 5000 }, (error, stdout, stderr) => {
        console.log('execFile callback');
        console.log('Error:', error);
        console.log('Stdout:', stdout);
        console.log('Stderr:', stderr);

        if (error) {
            return res.status(500).json({ error: error.message });
        }
        res.json(JSON.parse(stdout));
    });
});

app.listen(3002, () => {
    console.log('Debug server on http://localhost:3002');
});
