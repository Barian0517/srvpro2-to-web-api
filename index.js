const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { ZipArchive } = require('archiver');
const crypto = require('crypto');
const { Pool } = require('pg');
const lzma = require('lzma');

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const CONFIG_YAML_PATH = process.env.CONFIG_YAML_PATH;
const DIY_CARD_DIR = process.env.DIY_CARD_DIR;
const DATABASE_URL = process.env.DATABASE_URL;

let validCardDirs = [];

const pgPool = new Pool({
    connectionString: DATABASE_URL
});

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
let bundleHash = null;
let isReloading = false;
let reloadTimeout = null;

function updateBundleHash() {
    try {
        if (fs.existsSync(BUNDLE_ZIP_PATH)) {
            const hashSum = crypto.createHash('sha256');
            const stream = fs.createReadStream(BUNDLE_ZIP_PATH);
            stream.on('data', data => hashSum.update(data));
            stream.on('end', () => {
                bundleHash = hashSum.digest('hex');
                console.log(`Bundle hash updated: ${bundleHash}`);
            });
            stream.on('error', err => {
                console.error("Error reading bundle for hash:", err);
            });
        }
    } catch (err) {
        console.error("Error updating bundle hash:", err);
    }
}

function generateYpkBundle() {
    return new Promise((resolve, reject) => {
        const output = fs.createWriteStream(BUNDLE_ZIP_PATH);
        const archive = new ZipArchive({
            zlib: { level: 9 }
        });

        output.on('close', () => {
            console.log(`Bundle generated successfully: ${archive.pointer()} total bytes`);
            updateBundleHash();
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
    isReloading = true;
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
    try {
        await generateYpkBundle();
    } catch (err) {
        console.error("Error generating YPK bundle:", err);
    }
    isReloading = false;
}

function triggerReload() {
    if (isReloading) return;
    if (reloadTimeout) clearTimeout(reloadTimeout);
    reloadTimeout = setTimeout(() => {
        console.log("Detected changes in card directories, reloading...");
        loadDatabases().catch(err => console.error("Reload error:", err));
    }, 5000); // 5 seconds debounce
}

// Setup directory watching for automatic reload
validCardDirs.forEach(dir => {
    if (fs.existsSync(dir)) {
        try {
            fs.watch(dir, { recursive: true }, (eventType, filename) => {
                // Ignore the bundle.zip itself to prevent infinite reload loop
                if (filename && filename.includes('bundle.zip')) return;
                triggerReload();
            });
        } catch (err) {
            console.error(`Failed to watch directory ${dir}:`, err);
        }
    }
});

// Initial load
loadDatabases().catch(err => console.error("Initial load error:", err));

// 重新載入資料庫的 API
app.post('/api/refresh', async (req, res) => {
    await loadDatabases();
    res.json({ success: true, totalCards: cards.length, dbFilesFound });
});

app.get('/api/info', (req, res) => {
    res.json({
        validCardDirs,
        totalCards: cards.length,
        dbFilesFound,
        bundleHash
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

app.get('/api/hash', (req, res) => {
    if (bundleHash) {
        res.json({ hash: bundleHash });
    } else {
        res.status(404).json({ error: "Hash not available yet" });
    }
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

function parseDeckBuffer(base64Buffer) {
    if (!base64Buffer) return [];
    try {
        const buf = Buffer.from(base64Buffer, 'base64');
        const cardIds = [];
        // Skip first 2 uint32 if they are metadata, but let's just collect all valid IDs
        // Actually the first uint32 is mainc, second is extrac
        if (buf.length < 8) return [];
        for (let i = 8; i < buf.length; i += 4) {
            const id = buf.readUInt32LE(i);
            if (id > 0) cardIds.push(id);
        }
        return cardIds;
    } catch (err) {
        return [];
    }
}

const externalCardCache = new Map();

async function resolveDetailedDeck(base64Buffer) {
    if (!base64Buffer) return { main: [], extra: [], side: [] };
    
    let buf;
    try {
        buf = Buffer.from(base64Buffer, 'base64');
    } catch (e) {
        return { main: [], extra: [], side: [] };
    }
    if (buf.length < 8) return { main: [], extra: [], side: [] };
    
    const mainExtraCount = buf.readUInt32LE(0);
    const sideCount = buf.readUInt32LE(4);
    
    const mainExtraIds = [];
    const sideIds = [];
    
    let offset = 8;
    for (let i = 0; i < mainExtraCount && offset < buf.length; i++) {
        mainExtraIds.push(buf.readUInt32LE(offset));
        offset += 4;
    }
    for (let i = 0; i < sideCount && offset < buf.length; i++) {
        sideIds.push(buf.readUInt32LE(offset));
        offset += 4;
    }
    
    const allIds = [...mainExtraIds, ...sideIds];
    const unknownIds = new Set();
    for (const id of allIds) {
        if (!cardMap.has(id) && !externalCardCache.has(id)) {
            unknownIds.add(id);
        }
    }
    
    await Promise.all(Array.from(unknownIds).map(async (id) => {
        try {
            const res = await fetch(`https://ygocdb.com/api/v0/?search=${id}`);
            const data = await res.json();
            if (data && data.result && data.result.length > 0) {
                const name = data.result[0].cn_name || data.result[0].md_name || "Unknown";
                const type = data.result[0].data ? data.result[0].data.type : 0;
                externalCardCache.set(id, { name, type });
            } else {
                externalCardCache.set(id, { name: "Unknown", type: 0 });
            }
        } catch (e) {
            console.error(`Failed to fetch card info for ${id}:`, e);
            externalCardCache.set(id, { name: "Unknown", type: 0 });
        }
    }));
    
    const getCardType = id => {
        if (cardMap.has(id)) return cardMap.get(id).type || 0;
        if (externalCardCache.has(id)) return externalCardCache.get(id).type || 0;
        return 0;
    };
    
    const isExtraDeck = type => {
        const TYPE_FUSION = 0x40;
        const TYPE_SYNCHRO = 0x2000;
        const TYPE_XYZ = 0x800000;
        const TYPE_LINK = 0x4000000;
        return (type & TYPE_FUSION) || (type & TYPE_SYNCHRO) || (type & TYPE_XYZ) || (type & TYPE_LINK);
    };
    
    const main = [];
    const extra = [];
    const side = [];
    
    for (const id of mainExtraIds) {
        if (isExtraDeck(getCardType(id))) {
            extra.push(id);
        } else {
            main.push(id);
        }
    }
    
    for (const id of sideIds) {
        side.push(id);
    }
    
    return { main, extra, side };
}

app.get('/api/stats/months', async (req, res) => {
    try {
        const result = await pgPool.query(`
            SELECT DISTINCT to_char("startTime", 'YYYY-MM') as month
            FROM duel_record
            ORDER BY month DESC
        `);
        res.json(result.rows.map(r => r.month));
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Internal server error" });
    }
});

app.get('/api/stats/players', async (req, res) => {
    try {
        const month = req.query.month || new Date().toISOString().slice(0, 7);
        const result = await pgPool.query(`
            SELECT p."realName", p.name,
                   COUNT(*) as "totalMatches",
                   SUM(CASE WHEN p.winner THEN 1 ELSE 0 END) as "winCount"
            FROM duel_record_player p
            JOIN duel_record r ON p."duelRecordId" = r.id
            WHERE to_char(r."startTime", 'YYYY-MM') = $1
            GROUP BY p."realName", p.name
            ORDER BY "winCount" DESC, "totalMatches" DESC
        `, [month]);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Internal server error" });
    }
});

app.get('/api/stats/players/:name/decks', async (req, res) => {
    try {
        const month = req.query.month || new Date().toISOString().slice(0, 7);
        const playerName = req.params.name;
        
        const result = await pgPool.query(`
            SELECT DISTINCT p."startDeckBuffer"
            FROM duel_record_player p
            JOIN duel_record r ON p."duelRecordId" = r.id
            WHERE to_char(r."startTime", 'YYYY-MM') = $1 AND p."realName" = $2
        `, [month, playerName]);

        const decks = await Promise.all(result.rows.map(async row => {
            const detailed = await resolveDetailedDeck(row.startDeckBuffer);
            const mapInfo = id => {
                if (cardMap.has(id)) return { id, name: cardMap.get(id).name };
                return { id, name: externalCardCache.get(id)?.name || "Unknown" };
            };
            return {
                main: detailed.main.map(mapInfo),
                extra: detailed.extra.map(mapInfo),
                side: detailed.side.map(mapInfo)
            };
        }));

        res.json(decks);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Internal server error" });
    }
});

app.get('/api/stats/players/:name/records', async (req, res) => {
    try {
        const month = req.query.month || new Date().toISOString().slice(0, 7);
        const playerName = req.params.name;

        const result = await pgPool.query(`
            SELECT 
                r.id, r."startTime", r."endTime", r.name as "roomName",
                p."startDeckBuffer", p.winner,
                op."realName" as "opponentName", op."startDeckBuffer" as "opponentDeckBuffer"
            FROM duel_record_player p
            JOIN duel_record r ON p."duelRecordId" = r.id
            LEFT JOIN duel_record_player op ON op."duelRecordId" = r.id AND op.id != p.id
            WHERE to_char(r."startTime", 'YYYY-MM') = $1 AND p."realName" = $2
            ORDER BY r."startTime" DESC
        `, [month, playerName]);

        const records = await Promise.all(result.rows.map(async row => {
            const pDeck = await resolveDetailedDeck(row.startDeckBuffer);
            const oDeck = await resolveDetailedDeck(row.opponentDeckBuffer);
            const mapName = id => cardMap.get(id)?.name || externalCardCache.get(id)?.name || "Unknown";
            return {
                id: row.id,
                startTime: row.startTime,
                endTime: row.endTime,
                roomName: row.roomName,
                winner: row.winner,
                opponentName: row.opponentName,
                playerDeck: { main: pDeck.main.map(mapName), extra: pDeck.extra.map(mapName), side: pDeck.side.map(mapName) },
                opponentDeck: { main: oDeck.main.map(mapName), extra: oDeck.extra.map(mapName), side: oDeck.side.map(mapName) }
            };
        }));

        res.json(records);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Internal server error" });
    }
});

app.get('/api/stats/cards/ranking', async (req, res) => {
    try {
        const month = req.query.month || new Date().toISOString().slice(0, 7);
        const result = await pgPool.query(`
            SELECT p."startDeckBuffer"
            FROM duel_record_player p
            JOIN duel_record r ON p."duelRecordId" = r.id
            WHERE to_char(r."startTime", 'YYYY-MM') = $1
        `, [month]);

        const cardCounts = {};
        for (const row of result.rows) {
            const cardIds = parseDeckBuffer(row.startDeckBuffer);
            for (const id of cardIds) {
                cardCounts[id] = (cardCounts[id] || 0) + 1;
            }
        }

        const ranking = Object.entries(cardCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 50)
            .map(([id, count]) => {
                const numId = parseInt(id);
                return {
                    id: numId,
                    name: cardMap.get(numId)?.name || "Unknown",
                    count
                };
            });

        res.json(ranking);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Internal server error" });
    }
});

app.get('/api/stats/replays', async (req, res) => {
    try {
        const month = req.query.month || new Date().toISOString().slice(0, 7);
        const result = await pgPool.query(`
            SELECT 
                r.id, r."startTime", r."endTime", r.name as "roomName",
                p1."realName" as "player1", p1."startDeckBuffer" as "deck1", p1.winner as "p1Winner",
                p2."realName" as "player2", p2."startDeckBuffer" as "deck2", p2.winner as "p2Winner"
            FROM duel_record r
            LEFT JOIN duel_record_player p1 ON p1."duelRecordId" = r.id AND p1.pos = 0
            LEFT JOIN duel_record_player p2 ON p2."duelRecordId" = r.id AND p2.pos = 1
            WHERE to_char(r."startTime", 'YYYY-MM') = $1
            ORDER BY r."startTime" DESC
        `, [month]);

        const replays = result.rows.map(row => ({
            id: row.id,
            startTime: row.startTime,
            endTime: row.endTime,
            roomName: row.roomName,
            player1: row.player1,
            player2: row.player2,
            p1Winner: row.p1Winner,
            p2Winner: row.p2Winner,
            deck1Length: parseDeckBuffer(row.deck1).length,
            deck2Length: parseDeckBuffer(row.deck2).length
        }));

        res.json(replays);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Internal server error" });
    }
});

app.get('/api/stats/replays/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const result = await pgPool.query(`
            SELECT 
                r.id, r."startTime", r."endTime", r.name as "roomName",
                p1."realName" as "player1", p1."startDeckBuffer" as "deck1", p1.winner as "p1Winner",
                p2."realName" as "player2", p2."startDeckBuffer" as "deck2", p2.winner as "p2Winner"
            FROM duel_record r
            LEFT JOIN duel_record_player p1 ON p1."duelRecordId" = r.id AND p1.pos = 0
            LEFT JOIN duel_record_player p2 ON p2."duelRecordId" = r.id AND p2.pos = 1
            WHERE r.id = $1
        `, [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Replay not found" });
        }

        const row = result.rows[0];
        
        const deck1Detailed = await resolveDetailedDeck(row.deck1);
        const deck2Detailed = await resolveDetailedDeck(row.deck2);
        
        const mapName = id => cardMap.get(id)?.name || externalCardCache.get(id)?.name || "Unknown";

        res.json({
            id: row.id,
            startTime: row.startTime,
            endTime: row.endTime,
            roomName: row.roomName,
            player1: row.player1,
            player2: row.player2,
            p1Winner: row.p1Winner,
            p2Winner: row.p2Winner,
            deck1: { main: deck1Detailed.main.map(mapName), extra: deck1Detailed.extra.map(mapName), side: deck1Detailed.side.map(mapName) },
            deck2: { main: deck2Detailed.main.map(mapName), extra: deck2Detailed.extra.map(mapName), side: deck2Detailed.side.map(mapName) }
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Internal server error" });
    }
});

app.get('/api/stats/replays/:id/deck/:player', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const player = parseInt(req.params.player); // 1 or 2
        const pos = player === 1 ? 0 : 1;

        const result = await pgPool.query(`
            SELECT p."startDeckBuffer", p."realName"
            FROM duel_record_player p
            WHERE p."duelRecordId" = $1 AND p.pos = $2
        `, [id, pos]);

        if (result.rows.length === 0 || !result.rows[0].startDeckBuffer) {
            return res.status(404).json({ error: "Deck not found" });
        }

        const deck = await resolveDetailedDeck(result.rows[0].startDeckBuffer);
        const playerName = result.rows[0].realName || `player${player}`;

        let ydkContent = "#created by apiserver\n";
        ydkContent += "#main\n";
        deck.main.forEach(id => ydkContent += `${id}\n`);
        ydkContent += "#extra\n";
        deck.extra.forEach(id => ydkContent += `${id}\n`);
        ydkContent += "!side\n";
        deck.side.forEach(id => ydkContent += `${id}\n`);

        res.setHeader('Content-Type', 'text/plain');
        res.setHeader('Content-Disposition', `attachment; filename="${playerName}_deck.ydk"`);
        res.send(ydkContent);

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Internal server error" });
    }
});

app.get('/api/stats/replays/:id/download', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        
        // Fetch duel record messages and seed
        const recordRes = await pgPool.query(`
            SELECT r.messages, r.seed
            FROM duel_record r
            WHERE r.id = $1
        `, [id]);

        if (recordRes.rows.length === 0 || !recordRes.rows[0].messages) {
            return res.status(404).json({ error: "Replay not found" });
        }

        // Fetch all players for this replay
        const playersRes = await pgPool.query(`
            SELECT "realName", "startDeckBuffer", pos
            FROM duel_record_player
            WHERE "duelRecordId" = $1
            ORDER BY pos ASC
        `, [id]);

        const messagesBase64 = recordRes.rows[0].messages;
        const seed = recordRes.rows[0].seed || 0;
        const msgBuf = Buffer.from(messagesBase64, 'base64');
        
        const isTag = playersRes.rows.length > 2;
        const flag = isTag ? 1 : 0;
        
        const uncompressedParts = [];
        
        // Write player names (40 bytes UTF-16LE each)
        for (const player of playersRes.rows) {
            const nameBuf = Buffer.alloc(40);
            nameBuf.write(player.realName || `Player${player.pos + 1}`, 0, 'utf16le');
            uncompressedParts.push(nameBuf);
        }
        
        // Write player decks
        for (const player of playersRes.rows) {
            if (player.startDeckBuffer) {
                uncompressedParts.push(Buffer.from(player.startDeckBuffer, 'base64'));
            } else {
                // Empty deck fallback: mainc=0, sidec=0
                const emptyDeck = Buffer.alloc(8);
                uncompressedParts.push(emptyDeck);
            }
        }
        
        // Append messages
        uncompressedParts.push(msgBuf);
        
        const uncompressed = Buffer.concat(uncompressedParts);
        
        // 壓縮成 LZMA
        const compressed = Buffer.from(lzma.compress(uncompressed, 1));
        
        // 取出前 5 bytes 的 LZMA properties
        const props = compressed.slice(0, 5);
        // 取出真正的壓縮 payload (lzma node 模組的壓縮資料從 offset 13 開始)
        const payload = compressed.slice(13);

        // 建立 YRP 檔案標頭 (32 bytes)
        // id(4), version(4), flag(4), seed(4), data_size(4), hash(4), props(8)
        const header = Buffer.alloc(32);
        header.writeUInt32LE(0x31707279, 0); // 'yrp1'
        header.writeUInt32LE(0x136A, 4);     // version
        header.writeUInt32LE(flag, 8);       // flag
        header.writeUInt32LE(seed, 12);      // seed
        header.writeUInt32LE(uncompressed.length, 16); // uncompressed data_size
        header.writeUInt32LE(0, 20);         // hash
        
        // 將 5 bytes properties 寫入 props[8]
        props.copy(header, 24);

        // 組合標頭與壓縮資料
        const yrpBuf = Buffer.concat([header, payload]);

        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="replay_${id}.yrp"`);
        res.send(yrpBuf);

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Internal server error" });
    }
});

app.listen(PORT, () => {
    console.log(`YGO DIY API Server is running on http://localhost:${PORT}`);
    console.log(`Watching directories:\n${validCardDirs.join('\n')}`);
});
