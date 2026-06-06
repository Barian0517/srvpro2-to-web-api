const { Pool } = require('pg');
const lzma = require('lzma');
const fs = require('fs');
const pool = new Pool({connectionString: 'postgresql://srvpro:CHANGE_ME_DB_PASS@10.0.0.10:5433/srvpro2'});

async function test() {
    const res = await pool.query('SELECT r.messages, r.seed, p1."realName" as p1name, p2."realName" as p2name, p1."startDeckBuffer" as d1, p2."startDeckBuffer" as d2 FROM duel_record r JOIN duel_record_player p1 ON r.id=p1."duelRecordId" AND p1.pos=0 JOIN duel_record_player p2 ON r.id=p2."duelRecordId" AND p2.pos=1 WHERE r.id=25');
    const row = res.rows[0];
    const p1name = Buffer.alloc(40);
    p1name.write(row.p1name || 'Player1', 0, 'utf16le');
    const p2name = Buffer.alloc(40);
    p2name.write(row.p2name || 'Player2', 0, 'utf16le');
    
    const d1 = Buffer.from(row.d1, 'base64');
    const d2 = Buffer.from(row.d2, 'base64');
    const msgs = Buffer.from(row.messages, 'base64');
    
    // Tag mode = 4 names and 4 decks. But flag=0 means single mode (2 names, 2 decks)
    const uncompressed = Buffer.concat([p1name, p2name, d1, d2, msgs]);
    const compressed = Buffer.from(lzma.compress(uncompressed, 1));
    const props = compressed.slice(0, 5);
    const payload = compressed.slice(13);
    
    const header = Buffer.alloc(32);
    header.writeUInt32LE(0x31707279, 0); // yrp1
    header.writeUInt32LE(0x136A, 4);     // version
    header.writeUInt32LE(0, 8);          // flag
    header.writeUInt32LE(row.seed, 12);  // seed
    header.writeUInt32LE(uncompressed.length, 16); // data_size
    header.writeUInt32LE(0, 20);         // hash
    props.copy(header, 24);
    
    const yrpBuf = Buffer.concat([header, payload]);
    fs.writeFileSync('test.yrp', yrpBuf);
    console.log("Wrote test.yrp", yrpBuf.length);
    pool.end();
}
test();
