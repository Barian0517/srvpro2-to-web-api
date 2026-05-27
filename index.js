const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { ZipArchive } = require('archiver');

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const CONFIG_YAML_PATH = process.env.CONFIG_YAML_PATH;
const DIY_CARD_DIR = process.env.DIY_CARD_DIR;

let validCardDirs = [];

if (CONFIG_YAML_PATH) {
    if (!fs.existsSync(CONFIG_YAML_PATH)) {
        console.error(`Config file not found: ${CONFIG_YAML_PATH}`);
        process.exit(1);
    }
    const fileContents = fs.readFileSync(CONFIG_YAML_PATH, 'utf8');
    const config = yaml.load(fileContents);
    const baseDir = path.dirname(CONFIG_YAML_PATH);
    
    if (config.ygoproPath && Array.isArray(config.ygoproPath)) {
        validCardDirs = config.ygoproPath
            .filter(p => p !== './ygopro')
            .map(p => path.resolve(baseDir, p)); // 強制轉換為絕對路徑，解決 Linux TypeError
    }
} else if (DIY_CARD_DIR) {
    validCardDirs = [path.resolve(DIY_CARD_DIR)];
}

if (validCardDirs.length === 0) {
    console.error("No valid card directories found from CONFIG_YAML_PATH or DIY_CARD_DIR");
    process.exit(1);
}

let cards = [];
let cardMap = new Map();
let dbFilesFound = 0;
const BUNDLE_ZIP_PATH = path.join(__dirname, 'bundle.zip');

function generateYpkBundle() {
    return new Promise((resolve, reject) => {
        const output = fs.createWriteStream(BUNDLE_ZIP_PATH);
        const archive = new ZipArchive({
            zlib: { level: 9 }
        });

        output.on('close', () => {
            console.log(`Bundle generated successfully: ${archive.pointer()} total bytes`);
            resolve();
        });

        archive.on('error', (err) => {
            console.error('Error generating bundle:', err);
            reject(err);
        });

        archive.pipe(output);

        let ypkCount = 0;
        for (const dir of validCardDirs) {
            if (!fs.existsSync(dir)) continue;
            const files = fs.readdirSync(dir);
            const ypkFiles = files.filter(f => f.toLowerCase().endsWith('.ypk'));
            
            for (const ypkFile of ypkFiles) {
                const ypkPath = path.join(dir, ypkFile);
                const folderName = path.basename(dir);
                // 使用 資料夾名稱_檔案名稱 避免不同資料夾的 ypk 同名衝突
                archive.file(ypkPath, { name: `${folderName}_${ypkFile}` });
                ypkCount++;
            }
        }
        
        if (ypkCount === 0) {
            console.log("No YPK files found to bundle.");
        }

        archive.finalize();
    });
}

async function loadDatabases() {
    cards = [];
    cardMap.clear();
    dbFilesFound = 0;

    for (const dir of validCardDirs) {
        if (!fs.existsSync(dir)) {
            console.error(`Directory not found: ${dir}`);
            continue;
        }

        const files = fs.readdirSync(dir);
        const cdbFiles = files.filter(f => f.toLowerCase().endsWith('.cdb'));
        dbFilesFound += cdbFiles.length;

        for (const cdb of cdbFiles) {
            const dbPath = path.join(dir, cdb);
            try {
                const db = new Database(dbPath, { readonly: true });
                
                const stmt = db.prepare(`
                    SELECT d.*, t.name, t.desc, 
                    t.str1, t.str2, t.str3, t.str4, t.str5, t.str6, t.str7, t.str8, 
                    t.str9, t.str10, t.str11, t.str12, t.str13, t.str14, t.str15, t.str16
                    FROM datas d
                    JOIN texts t ON d.id = t.id
                `);
                const rows = stmt.all();
                
                for (const row of rows) {
                    if (!cardMap.has(row.id)) {
                        cards.push(row);
                        cardMap.set(row.id, row);
                    }
                }
                db.close();
                console.log(`Loaded ${rows.length} cards from ${dbPath}`);
            } catch (err) {
                console.error(`Error loading database ${dbPath}:`, err.message);
            }
        }
    }
    console.log(`Total cards loaded: ${cards.length}`);
    await generateYpkBundle();
}

// Initial load
loadDatabases();

// 重新載入資料庫的 API
app.post('/api/refresh', async (req, res) => {
    await loadDatabases();
    res.json({ success: true, totalCards: cards.length, dbFilesFound });
});

app.get('/api/info', (req, res) => {
    res.json({
        validCardDirs,
        totalCards: cards.length,
        dbFilesFound
    });
});

app.get('/api/cards', (req, res) => {
    // 回傳基本資訊供列表使用
    const summary = cards.map(c => ({
        id: c.id,
        name: c.name,
        type: c.type,
        level: c.level,
        atk: c.atk,
        def: c.def,
        attribute: c.attribute,
        race: c.race
    }));
    res.json(summary);
});

app.get('/api/cards/:id', (req, res) => {
    const id = parseInt(req.params.id);
    const card = cardMap.get(id);
    
    if (!card) {
        return res.status(404).json({ error: "Card not found" });
    }

    let hasImage = false;
    let imageType = null;
    let hasScript = false;

    for (const dir of validCardDirs) {
        if (!hasImage) {
            const imageJpg = path.join(dir, 'pics', `${id}.jpg`);
            const imagePng = path.join(dir, 'pics', `${id}.png`);
            if (fs.existsSync(imageJpg)) { hasImage = true; imageType = 'jpg'; }
            else if (fs.existsSync(imagePng)) { hasImage = true; imageType = 'png'; }
        }
        if (!hasScript) {
            const scriptPath = path.join(dir, 'script', `c${id}.lua`);
            if (fs.existsSync(scriptPath)) { hasScript = true; }
        }
        if (hasImage && hasScript) break;
    }

    res.json({
        ...card,
        hasImage,
        imageType,
        hasScript
    });
});

app.get('/api/images/:id', (req, res) => {
    const id = parseInt(req.params.id);
    
    for (const dir of validCardDirs) {
        const imageJpg = path.join(dir, 'pics', `${id}.jpg`);
        const imagePng = path.join(dir, 'pics', `${id}.png`);

        if (fs.existsSync(imageJpg)) {
            return res.sendFile(path.resolve(imageJpg));
        } else if (fs.existsSync(imagePng)) {
            return res.sendFile(path.resolve(imagePng));
        }
    }
    res.status(404).json({ error: "Image not found" });
});

app.get('/api/scripts/:id', (req, res) => {
    const id = parseInt(req.params.id);
    
    for (const dir of validCardDirs) {
        const scriptPath = path.join(dir, 'script', `c${id}.lua`);

        if (fs.existsSync(scriptPath)) {
            res.type('text/plain');
            return res.sendFile(path.resolve(scriptPath));
        }
    }
    res.status(404).json({ error: "Script not found" });
});

app.get('/api/download/ypk', (req, res) => {
    try {
        if (fs.existsSync(BUNDLE_ZIP_PATH)) {
            res.download(BUNDLE_ZIP_PATH, 'bundle.zip');
        } else {
            res.status(404).json({ error: "YPK bundle not found or not generated yet" });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Internal server error" });
    }
});

app.listen(PORT, () => {
    console.log(`YGO DIY API Server is running on http://localhost:${PORT}`);
    console.log(`Watching directories:\n${validCardDirs.join('\n')}`);
});
