require('dotenv').config();
const express = require('express');
const { execFile } = require('child_process');
const path = require('path');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');

const app = express();
const PORT = process.env.PORT || 3001;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Security: Helmet for HTTP headers
app.use(helmet());

// CORS configuration
const corsOptions = {
    origin: NODE_ENV === 'production'
        ? process.env.ALLOWED_ORIGINS?.split(',') || []
        : ['http://localhost:5173', 'http://localhost:3000'],
    credentials: true,
    optionsSuccessStatus: 200
};
app.use(cors(corsOptions));

// Rate limiting to prevent abuse
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per windowMs
    message: 'Too many requests from this IP, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
});
app.use('/api/', limiter);

// Path to the compiled C++ CLI tool
const CLI_PATH = path.resolve(__dirname, '../build/bin/fivo_demo');
const LIB_PATH = path.resolve(__dirname, '../build/bin');

// Environment variables for execFile (needed for shared libraries)
const execEnv = {
    ...process.env,
    DYLD_LIBRARY_PATH: LIB_PATH, // macOS
    LD_LIBRARY_PATH: LIB_PATH    // Linux (for Docker/Railway)
};

app.get('/', (req, res) => {
    res.send('Fivo Bridge API is running. Use /api/chord?key=C&root=G');
});

app.get('/api/chord', (req, res) => {
    const key = req.query.key || 'C';
    const root = req.query.root || 'C';
    const inversion = req.query.inversion || '0';

    // Validate inputs to prevent injection
    if (!/^[A-Ga-g][#b]?$/.test(key) || !/^[A-Ga-g][#b]?$/.test(root)) {
        return res.status(400).json({ error: "Invalid Key or Root format" });
    }

    const inversionNum = parseInt(inversion, 10);
    if (isNaN(inversionNum) || inversionNum < 0 || inversionNum > 2) {
        return res.status(400).json({ error: "Invalid Inversion (must be 0, 1, or 2)" });
    }

    // Use execFile instead of exec for security (no shell injection)
    const args = ['--json', key, root, '--inversion', inversionNum.toString()];

    execFile(CLI_PATH, args, { timeout: 5000, env: execEnv }, (error, stdout, stderr) => {
        if (error) {
            console.error(`[Error] execFile error:`, error.message);
            if (stderr) console.error(`[Stderr]:`, stderr);
            return res.status(500).json({ error: "Failed to process chord" });
        }

        try {
            const data = JSON.parse(stdout.trim());
            if (NODE_ENV === 'development') {
                console.log(`[Core] ${key} -> ${root} (inv:${inversionNum}): ${data.relation}`);
            }
            res.json(data);
        } catch (e) {
            console.error("[Error] JSON Parse Error:", e.message);
            console.error("[Stdout]:", stdout);
            res.status(500).json({ error: "Invalid response from core engine" });
        }
    });
});

app.get('/api/context', (req, res) => {
    const key = req.query.key || 'C';

    // Validate
    if (!/^[A-Ga-g][#b]?$/.test(key)) {
        return res.status(400).json({ error: "Invalid Key format" });
    }

    // Use execFile instead of exec for security
    const args = ['--context', key];

    execFile(CLI_PATH, args, { timeout: 5000, env: execEnv }, (error, stdout, stderr) => {
        if (error) {
            console.error(`[Error] execFile error:`, error.message);
            if (stderr) console.error(`[Stderr]:`, stderr);
            return res.status(500).json({ error: "Failed to process context" });
        }

        try {
            const data = JSON.parse(stdout.trim());
            if (NODE_ENV === 'development') {
                console.log(`[Core] Context for Key ${key}`);
            }
            res.json(data);
        } catch (e) {
            console.error("[Error] JSON Parse Error:", e.message);
            console.error("[Stdout]:", stdout);
            res.status(500).json({ error: "Invalid response from core engine" });
        }
    });
});

app.listen(PORT, () => {
    console.log(`Fivo Bridge Server running on http://localhost:${PORT}`);
    console.log(`Core Path: ${CLI_PATH}`);
});
