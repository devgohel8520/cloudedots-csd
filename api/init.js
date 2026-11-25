const { sql } = require('@vercel/postgres');
const crypto = require('crypto');

module.exports = async function handler(req, res) {
    const secret = process.env.INIT_SECRET;
    if (secret && req.query.secret !== secret) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        const { rows: tblCheck } = await sql.query(`
          SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'contacts')
        `);
        const tableExists = tblCheck[0]?.exists;

        if (!tableExists) {
            await sql`
          CREATE TABLE contacts (
            id          SERIAL PRIMARY KEY,
            name        TEXT NOT NULL,
            company     TEXT DEFAULT '',
            designation TEXT DEFAULT '',
            mobile      TEXT DEFAULT '',
            email       TEXT DEFAULT '',
            status      TEXT DEFAULT 'Contact',
            source      TEXT DEFAULT '',
            location    TEXT DEFAULT '',
            link        TEXT DEFAULT '',
            created_by  TEXT DEFAULT '',
            status_updated_by TEXT DEFAULT '',
            status_updated_at TIMESTAMPTZ DEFAULT NOW(),
            response TEXT DEFAULT '',
            poc_name TEXT DEFAULT '',
            poc_phone TEXT DEFAULT '',
            poc_designation TEXT DEFAULT '',
            assigned_to TEXT DEFAULT '',
            service_plan TEXT DEFAULT '',
            link2 TEXT DEFAULT '',
            created_at  TIMESTAMPTZ DEFAULT NOW()
          )
        `;

            await sql`
          CREATE TABLE remarks (
            id           SERIAL PRIMARY KEY,
            contact_id   INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
            contact_name TEXT DEFAULT '',
            remark       TEXT NOT NULL,
            image        TEXT DEFAULT '',
            created_by   TEXT DEFAULT '',
            created_at   TIMESTAMPTZ DEFAULT NOW()
          )
        `;

            await sql.query(`ALTER TABLE remarks DROP CONSTRAINT IF EXISTS remarks_contact_id_key`);

            await sql`
          CREATE TABLE reminders (
            id           SERIAL PRIMARY KEY,
            contact_id   INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
            contact_name TEXT DEFAULT '',
            type         TEXT DEFAULT 'Phone',
            date         TEXT NOT NULL,
            time         TEXT NOT NULL,
            agenda       TEXT NOT NULL,
            meeting_location TEXT DEFAULT '',
            map_link     TEXT DEFAULT '',
            user_name    TEXT DEFAULT '',
            guest_user_name TEXT DEFAULT '',
            status       TEXT DEFAULT 'Pending',
            created_by   TEXT DEFAULT '',
            created_at   TIMESTAMPTZ DEFAULT NOW()
          )
        `;

            await sql`
          CREATE TABLE users (
            id         SERIAL PRIMARY KEY,
            name       TEXT NOT NULL,
            email      TEXT NOT NULL UNIQUE,
            password   TEXT NOT NULL,
            role       TEXT NOT NULL DEFAULT 'Executive',
            created_at TIMESTAMPTZ DEFAULT NOW()
          )
        `;

            await sql`
          CREATE TABLE service_plans (
            id         SERIAL PRIMARY KEY,
            name       TEXT NOT NULL UNIQUE,
            price      TEXT DEFAULT '',
            billing    TEXT DEFAULT '',
            features   TEXT DEFAULT '',
            created_at TIMESTAMPTZ DEFAULT NOW()
          )
        `;
        } else {
            await sql.query(`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS created_by TEXT DEFAULT ''`);
            await sql.query(`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS status_updated_by TEXT DEFAULT ''`);
            await sql.query(`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS status_updated_at TIMESTAMPTZ DEFAULT NOW()`);
            await sql.query(`UPDATE contacts SET status_updated_at = created_at WHERE status_updated_at IS NULL`);
            await sql.query(`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS response TEXT DEFAULT ''`);
            await sql.query(`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS poc_name TEXT DEFAULT ''`);
            await sql.query(`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS poc_phone TEXT DEFAULT ''`);
            await sql.query(`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS poc_designation TEXT DEFAULT ''`);
            await sql.query(`ALTER TABLE remarks DROP CONSTRAINT IF EXISTS remarks_contact_id_key`);
            await sql.query(`ALTER TABLE reminders ADD COLUMN IF NOT EXISTS meeting_location TEXT DEFAULT ''`);
            await sql.query(`ALTER TABLE reminders ADD COLUMN IF NOT EXISTS user_name TEXT DEFAULT ''`);
            await sql.query(`ALTER TABLE reminders ADD COLUMN IF NOT EXISTS guest_user_name TEXT DEFAULT ''`);
            await sql.query(`ALTER TABLE reminders ADD COLUMN IF NOT EXISTS map_link TEXT DEFAULT ''`);
            await sql.query(`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS assigned_to TEXT DEFAULT ''`);
            await sql.query(`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS link2 TEXT DEFAULT ''`);
            await sql.query(`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS service_plan TEXT DEFAULT ''`);
            await sql.query(`CREATE TABLE IF NOT EXISTS service_plans (
              id SERIAL PRIMARY KEY,
              name TEXT NOT NULL UNIQUE,
              price TEXT DEFAULT '',
              billing TEXT DEFAULT '',
              features TEXT DEFAULT '',
              created_at TIMESTAMPTZ DEFAULT NOW()
            )`);
        }

        // seed service plans
        const plans = [
            ['CSD Starter', '₹82,000 – ₹99,000', 'One-time', 'Audit of one business function; End-to-end requirement gathering; Solution design and implementation; 1 requirement-gathering meeting; 20-day project timeline; 10 days post-implementation support; Choose starting department (Sales/Marketing/Production/Quality/Dispatch)'],
            ['CSD 1 — Basic', '₹15,000 / month', 'Monthly (12-month agreement)', '1 requirement-gathering session/month; 4 hours per session; 1x development capacity'],
            ['CSD 2 — Pro', '₹30,000 / month', 'Monthly (12-month agreement)', '2 requirement-gathering sessions/month; 4 hours per session; 2x development capacity'],
            ['CSD 3 — Max', '₹50,000 / month', 'Monthly (12-month agreement)', '3 requirement-gathering sessions/month; 4 hours per session; 3x development capacity'],
            ['CSD 4 — Supermax', '₹1,00,000 / month', 'Monthly (12-month agreement)', '4 requirement-gathering sessions/month; 4 hours per session; 4x development capacity; Free VPS server included (1 vCPU, 4 GB RAM, 50 GB NVMe, 4 TB bandwidth)'],
        ];
        for (const p of plans) {
            await sql`
              INSERT INTO service_plans (name, price, billing, features)
              VALUES (${p[0]}, ${p[1]}, ${p[2]}, ${p[3]})
              ON CONFLICT (name) DO NOTHING
            `;
        }

        const hash = crypto.createHash('sha256').update('admin@123#1').digest('hex');
        await sql`
      INSERT INTO users (name, email, password, role)
      VALUES ('Devendra Gohel', 'dev@cloudedots.com', ${hash}, 'Admin')
      ON CONFLICT (email) DO NOTHING
    `;

        res.status(200).json({ success: true, message: 'All tables created and admin user seeded.' });
    } catch (err) {
        console.error('Init error:', err);
        res.status(500).json({ error: err.message });
    }
};
