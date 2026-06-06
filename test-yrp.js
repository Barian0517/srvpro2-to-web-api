const { Pool } = require('pg');
const { YGOProYrp, ReplayHeader } = require('ygopro-yrp-encode');
const YGOProDeck = require('ygopro-deck-encode').default;
const fs = require('fs');

const pool = new Pool({connectionString: 'postgresql://srvpro:CHANGE_ME_DB_PASS@10.0.0.10:5433/srvpro2'});

const OcgcoreDuelOptionFlag = {
  PseudoShuffle: 0x40,
  TagMode: 0x20
};

function calculateDuelOptions(hostinfo) {
  let opt = (hostinfo.duel_rule || 0) << 16;
  if (hostinfo.no_shuffle_deck) opt |= OcgcoreDuelOptionFlag.PseudoShuffle;
  if ((hostinfo.mode || 0) & 0x2) opt |= OcgcoreDuelOptionFlag.TagMode;
  return opt;
}

function parseDeckBufferToYGOProDeck(base64Buffer) {
  if (!base64Buffer) return null;
  const buf = Buffer.from(base64Buffer, 'base64');
  if (buf.length < 8) return null;
  const mainc = buf.readUInt32LE(0);
  const sidec = buf.readUInt32LE(4);
  const main = [];
  const side = [];
  let offset = 8;
  for (let i = 0; i < mainc && offset < buf.length; i++) {
    main.push(buf.readUInt32LE(offset));
    offset += 4;
  }
  for (let i = 0; i < sidec && offset < buf.length; i++) {
    side.push(buf.readUInt32LE(offset));
    offset += 4;
  }
  // ygopro-deck-encode uses main, extra, side. We just put all main/extra into main array, 
  // ygopro-yrp-encode actually just combines main and extra when encoding replay decks anyway!
  // Wait, let's look at YGOProDeck properties. It has main, extra, side.
  // I will just put all mainc into main.
  return new YGOProDeck({ main: main, extra: [], side: side, name: '' });
}

async function generateYrp() {
    const res = await pool.query('SELECT * FROM duel_record r WHERE r.id=25');
    const row = res.rows[0];
    const hostinfo = row.hostInfo || {};
    
    const playersRes = await pool.query('SELECT * FROM duel_record_player WHERE "duelRecordId"=25 ORDER BY pos');
    const players = playersRes.rows;
    
    const isTag = players.length > 2;
    
    const header = new ReplayHeader();
    header.id = 0x32707279; // YRP2 or YRP1? srvpro2 uses 0x32707279 which is yrp2. Let's use 0x31707279 (yrp1) for standard YGOPro
    header.id = 0x31707279; 
    header.version = 0x1362;
    header.flag = 0x1 | 0x10; // COMPRESSED | UNIFORM
    if (isTag) header.flag |= 0x2; // TAG
    header.seedSequence = row.seed ? [row.seed] : [];
    header.hash = Math.floor(new Date(row.startTime).getTime() / 1000);
    
    const responsesBuf = row.responses ? Buffer.from(row.responses, 'base64') : Buffer.alloc(0);
    
    // In node, to pass responses buffer correctly if it expects an array of Uint8Arrays:
    // Wait, responses is a single Buffer in my DB? Yes, but ygopro-yrp-encode expects an array of Uint8Arrays?
    // Let's check srvpro2 source: `this.responses.map(buf => new Uint8Array(buf))`
    // If duel_record stores all responses concatenated in one base64 string, I might just pass `[new Uint8Array(responsesBuf)]`.
    // Actually, `ygopro-yrp-encode` concatenates them. Passing an array of one Uint8Array is fine.
    
    const yrp = new YGOProYrp({
      header,
      hostName: players[0]?.realName || '',
      clientName: isTag ? players[3]?.realName || '' : players[1]?.realName || '',
      startLp: hostinfo.start_lp || 8000,
      startHand: hostinfo.start_hand || 5,
      drawCount: hostinfo.draw_count || 1,
      opt: calculateDuelOptions(hostinfo),
      hostDeck: parseDeckBufferToYGOProDeck(players[0]?.startDeckBuffer),
      clientDeck: isTag
        ? parseDeckBufferToYGOProDeck(players[2]?.startDeckBuffer)
        : parseDeckBufferToYGOProDeck(players[1]?.startDeckBuffer),
      tagHostName: isTag ? players[1]?.realName || '' : null,
      tagClientName: isTag ? players[2]?.realName || '' : null,
      tagHostDeck: isTag ? parseDeckBufferToYGOProDeck(players[1]?.startDeckBuffer) : null,
      tagClientDeck: isTag ? parseDeckBufferToYGOProDeck(players[3]?.startDeckBuffer) : null,
      singleScript: null,
      responses: [new Uint8Array(responsesBuf)],
    });
    
    const outBuf = yrp.toYrp();
    fs.writeFileSync('test_encode.yrp', Buffer.from(outBuf));
    console.log("Written test_encode.yrp", outBuf.length);
    pool.end();
}
generateYrp().catch(console.error);
