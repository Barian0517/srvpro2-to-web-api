const {Pool} = require('pg');
const pool = new Pool({connectionString: 'postgresql://srvpro:CHANGE_ME_DB_PASS@10.0.0.10:5433/srvpro2'});
pool.query('SELECT "hostInfo" FROM duel_record WHERE id=25').then(res => {
    console.log(res.rows[0].hostInfo);
    pool.end();
});
