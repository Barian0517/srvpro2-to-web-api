const {Pool} = require('pg');
const pool = new Pool({connectionString: 'postgresql://srvpro:CHANGE_ME_DB_PASS@10.0.0.10:5433/srvpro2'});
pool.query('SELECT p."startDeckBuffer", p."realName" FROM duel_record_player p WHERE p."duelRecordId"=25 ORDER BY p.pos').then(res => {
    res.rows.forEach(r => {
        console.log(r.realName, Buffer.from(r.startDeckBuffer, 'base64').slice(0, 16).toString('hex'));
    });
    pool.end();
});
