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

// Trust Railway/proxy headers so rate limiting uses real client IP
app.set('trust proxy', 1);

// CORS configuration
app.use(cors({ origin: true, credentials: true, optionsSuccessStatus: 200 }));

// Rate limiting to prevent abuse (por usuario real, no por proxy compartido)
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: NODE_ENV === 'production' ? 600 : 1000,
    message: 'Too many requests from this IP, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
});
app.use('/api/', limiter);

// Path to the compiled C++ CLI tool
const isWindows = process.platform === 'win32';
const CLI_PATH = path.resolve(__dirname, '../build/bin/fivo_demo' + (isWindows ? '.exe' : '')).replace(/\\/g, '/');
const LIB_PATH = path.resolve(__dirname, '../build/bin').replace(/\\/g, '/');

// Environment variables for execFile (needed for shared libraries)
const execEnv = {
    ...process.env,
    DYLD_LIBRARY_PATH: LIB_PATH, // macOS
    LD_LIBRARY_PATH: LIB_PATH,   // Linux (for Docker/Railway)
    // Windows: agregar directorio de DLL al PATH
    PATH: isWindows
        ? `${LIB_PATH.replace(/\//g, '\\')};${process.env.PATH}`
        : process.env.PATH
};

app.get('/', (req, res) => {
    res.send('Fivo Bridge API is running. Use /api/chord?key=C&root=G');
});

// Valid styles for validation
const VALID_STYLES = ['pop', 'rock', 'jazz', 'bossa'];

app.get('/api/chord', (req, res) => {
    const key = req.query.key || 'C';
    const root = req.query.root || 'C';
    const inversion = req.query.inversion || '0';
    const style = (req.query.style || 'pop').toLowerCase();
    const isMinor = req.query.minor === 'true';
    const powerMode = req.query.power || 'auto'; // 'auto', 'on', 'off'
    const fingers = req.query.fingers || '3'; // 1, 2, or 3 notes

    // Validate inputs to prevent injection
    // Allow minor keys like "Am", "Em", etc.
    if (!/^[A-Ga-g][#b]?m?$/.test(key) || !/^[A-Ga-g][#b]?$/.test(root)) {
        return res.status(400).json({ error: "Invalid Key or Root format" });
    }

    const inversionNum = parseInt(inversion, 10);
    if (isNaN(inversionNum) || inversionNum < 0 || inversionNum > 2) {
        return res.status(400).json({ error: "Invalid Inversion (must be 0, 1, or 2)" });
    }

    // Validate style
    if (!VALID_STYLES.includes(style)) {
        return res.status(400).json({ error: "Invalid Style (must be pop, rock, jazz, or bossa)" });
    }

    // Validate fingers (1, 2, or 3)
    const fingersNum = parseInt(fingers, 10);
    if (isNaN(fingersNum) || fingersNum < 1 || fingersNum > 3) {
        return res.status(400).json({ error: "Invalid Fingers (must be 1, 2, or 3)" });
    }

    // Use execFile instead of exec for security (no shell injection)
    const args = ['--json', key, root, '--inversion', inversionNum.toString(), '--style', style, '--fingers', fingersNum.toString()];
    if (isMinor) {
        args.push('--minor');
    }
    if (powerMode === 'auto' || powerMode === 'on') {
        args.push('--power', powerMode);
    }
    console.log('[DEBUG] minor param:', req.query.minor, '-> isMinor:', isMinor, '-> fingers:', fingersNum, '-> args:', args);

    execFile(CLI_PATH, args, { timeout: 5000, env: execEnv }, (error, stdout, stderr) => {
        if (error) {
            console.error(`[Error] execFile error:`, error.message);
            if (stderr) console.error(`[Stderr]:`, stderr);
            return res.status(500).json({ error: "Failed to process chord" });
        }

        try {
            const data = JSON.parse(stdout.trim());
            if (NODE_ENV === 'development') {
                console.log(`[Core] ${key} -> ${root} (inv:${inversionNum}, style:${style}): ${data.relation}`);
            }
            return res.json(data);
        } catch (e) {
            console.error("[Error] JSON Parse Error:", e.message);
            console.error("[Stdout]:", stdout);
            return res.status(500).json({ error: "Invalid response from core engine" });
        }
    });
});

app.get('/api/context', (req, res) => {
    const key = req.query.key || 'C';
    const style = (req.query.style || 'pop').toLowerCase();

    // Validate key (allow minor keys like "Am", "Em", etc.)
    if (!/^[A-Ga-g][#b]?m?$/.test(key)) {
        return res.status(400).json({ error: "Invalid Key format" });
    }

    // Validate style
    if (!VALID_STYLES.includes(style)) {
        return res.status(400).json({ error: "Invalid Style (must be pop, rock, jazz, or bossa)" });
    }

    // Use execFile instead of exec for security
    const args = ['--context', key, '--style', style];
    console.log('[DEBUG] CLI_PATH:', CLI_PATH, 'args:', args);

    execFile(CLI_PATH, args, { timeout: 5000, env: execEnv }, (error, stdout, stderr) => {
        if (error) {
            console.error(`[Error] execFile error:`, error.message, error);
            if (stderr) console.error(`[Stderr]:`, stderr);
            return res.status(500).json({ error: "Failed to process context" });
        }

        try {
            const data = JSON.parse(stdout.trim());
            if (NODE_ENV === 'development') {
                console.log(`[Core] Context for Key ${key} (style:${style})`);
            }
            return res.json(data);
        } catch (e) {
            console.error("[Error] JSON Parse Error:", e.message);
            console.error("[Stdout]:", stdout);
            return res.status(500).json({ error: "Invalid response from core engine" });
        }
    });
});

// Listen on all interfaces (0.0.0.0) for local network access
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Fivo Bridge Server running on http://0.0.0.0:${PORT}`);
    console.log(`Core Path: ${CLI_PATH}`);
});
