const { sql } = require('@vercel/postgres');
const crypto = require('crypto');

const STATUSES = ['Contact', 'Meeting', 'Confirmation', 'Sales Order', 'Receive', 'Payment', 'Invoice', 'Schedule', 'Requirement Gathering & Finalization', '20 Development', '10 Day Support', 'Feedback', 'Completed', 'Cancelled'];

function normalizeStatus(v) {
    const s = String(v == null ? '' : v).trim();
    if (!s) return 'Contact';
    const low = s.toLowerCase();
    if (low === 'new' || low === 'leads' || low === 'contact') return 'Contact';
    if (low === 'completed' || low === 'won') return 'Completed';
    if (low === 'cancelled' || low === 'canceled') return 'Cancelled';
    const match = STATUSES.find(x => x.toLowerCase() === low);
    return match || s;
}

// Fast2SMS WhatsApp config (template: piplhr_business_intro_v1)
const FAST2SMS_WA_MESSAGE_ID = process.env.FAST2SMS_WA_MESSAGE_ID;
const FAST2SMS_WA_PHONE_NUMBER_ID = process.env.FAST2SMS_WA_PHONE_NUMBER_ID;

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') { res.status(200).end(); return; }
    if (req.method !== 'POST') { res.writeHead(302, { Location: '/' }); res.end(); return; }

    let body = req.body;
    if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch (e) {
            return res.status(400).json({ error: 'Invalid JSON body' });
        }
    }

    const { fn, args = [], user } = body || {};
    const userId = user ? user.id : null;
    const userName = user ? user.name : '';
    const userRole = user ? user.role : '';

    try {
        let result;
        switch (fn) {

            // ── login ─────────────────────────────────────────────────────────────────
            case 'login': {
                const [email, password] = args;
                const hash = crypto.createHash('sha256').update(password).digest('hex');
                const { rows } = await sql`
              SELECT id, name, email, role FROM users WHERE email = ${email} AND password = ${hash}
            `;
                if (rows.length === 0) {
                    return res.status(200).json({ result: null, error: 'Invalid email or password' });
                }
                result = rows[0];
                break;
            }

            // ── addUser (Admin only) ──────────────────────────────────────────────────
            case 'addUser': {
                if (userRole !== 'Admin') return res.status(200).json({ result: null, error: 'Only admins can add users' });
                const u = args[0] || {};
                const hash = crypto.createHash('sha256').update(u.password || '').digest('hex');
                const { rows } = await sql`
              INSERT INTO users (name, email, password, role)
              VALUES (${u.name}, ${u.email}, ${hash}, ${u.role || 'Executive'})
              RETURNING id, name, email, role
            `;
                result = rows[0];
                break;
            }

            // ── getUsers ─────────────────────────────────────────────────
            case 'getUsers': {
                const { rows } = await sql`
              SELECT id, name, email, role, created_at FROM users ORDER BY id
            `;
                result = rows;
                break;
            }

            // ── deleteUser (Admin only) ───────────────────────────────────────────────
            case 'deleteUser': {
                if (userRole !== 'Admin') return res.status(200).json({ result: null, error: 'Only admins can delete users' });
                const [id] = args;
                await sql`DELETE FROM users WHERE id = ${id}`;
                result = { success: true };
                break;
            }

            // ── getContactById ───────────────────────────────────────────────────────
            case 'getContactById': {
                const [id] = args;
                const { rows } = await sql`SELECT * FROM contacts WHERE id = ${id}`;
                if (rows.length === 0) { result = null; break; }
                const r = rows[0];
                result = {
                    row: r.id,
                    name: r.name || '',
                    company: r.company || '',
                    designation: r.designation || '',
                    mobile: r.mobile || '',
                    email: r.email || '',
                    status: r.status || 'Contact',
                    source: r.source || '',
                    location: r.location || '',
                    link: r.link || '',
                    link2: r.link2 || '',
                    assigned_to: r.assigned_to || '',
                    service_plan: r.service_plan || '',
                };
                break;
            }

            // ── getAllData ──────────────────────────────────────────────────────────
            case 'getAllData': {
                const { rows } = await sql`
              SELECT * FROM contacts ORDER BY created_at DESC
            `;
                let contacts = rows.map(r => ({
                    row: r.id,
                    name: r.name || '',
                    company: r.company || '',
                    designation: r.designation || '',
                    mobile: r.mobile || '',
                    email: r.email || '',
                    status: normalizeStatus(r.status),
                    source: r.source || '',
                    location: r.location || '',
                    link: r.link || '',
                    link2: r.link2 || '',
                    response: r.response || '',
                    poc_name: r.poc_name || '',
                    poc_phone: r.poc_phone || '',
                    poc_designation: r.poc_designation || '',
                    assigned_to: r.assigned_to || '',
                    service_plan: r.service_plan || '',
                    created_at: r.created_at || null,
                }));

                // Role-based filtering: Executive sees only assigned + New contacts
                if (userRole === 'Executive') {
                    contacts = contacts.filter(c =>
                        c.status === 'Contact' || c.assigned_to === userName
                    );
                }

                const stats = { 'Contact': 0, 'Meeting': 0, 'Confirmation': 0, 'Sales Order': 0, 'Receive': 0, 'Payment': 0, 'Invoice': 0, 'Schedule': 0, 'Requirement Gathering & Finalization': 0, '20 Development': 0, '10 Day Support': 0, 'Feedback': 0, 'Completed': 0, 'Cancelled': 0 };
                contacts.forEach(c => { if (stats.hasOwnProperty(c.status)) stats[c.status]++; });

                result = { contacts, stats };
                break;
            }

            // ── checkDuplicate ──────────────────────────────────────────────────────
            case 'checkDuplicate': {
                const { mobile, company, excludeId } = args[0] || {};
                let dupMobile = null, dupCompany = null;
                if (mobile) {
                    const q = excludeId
                        ? sql`SELECT id, name, mobile FROM contacts WHERE mobile = ${mobile} AND id != ${excludeId} LIMIT 1`
                        : sql`SELECT id, name, mobile FROM contacts WHERE mobile = ${mobile} LIMIT 1`;
                    const { rows } = await q;
                    if (rows.length > 0) dupMobile = rows[0];
                }
                if (company) {
                    const q = excludeId
                        ? sql`SELECT id, name, company FROM contacts WHERE LOWER(company) = LOWER(${company}) AND id != ${excludeId} LIMIT 1`
                        : sql`SELECT id, name, company FROM contacts WHERE LOWER(company) = LOWER(${company}) LIMIT 1`;
                    const { rows } = await q;
                    if (rows.length > 0) dupCompany = rows[0];
                }
                result = { dupMobile, dupCompany };
                break;
            }
            case 'addNewContact': {
                const c = args[0] || {};
                const { rows } = await sql.query(`
              INSERT INTO contacts (name, company, designation, mobile, email, status, source, location, link, link2, response, poc_name, poc_phone, poc_designation, service_plan, created_by, status_updated_by, status_updated_at)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, NOW())
              RETURNING id
            `, [c.name || '', c.company || '', c.designation || '', c.mobile || '',
                    c.email || '', c.status || 'Contact', c.source || '', c.location || '',
                    c.link || '', c.link2 || '', c.response || '', c.poc_name || '', c.poc_phone || '', c.poc_designation || '', c.service_plan || '', userName || '', userName || '']);
                const newId = rows[0].id;
                if (userName) {
                    await sql`
                INSERT INTO remarks (contact_id, contact_name, remark, created_by)
                VALUES (${newId}, ${c.name || ''}, ${'Contact created by ' + userName}, ${userName})
              `;
                }
                result = { success: true, id: newId };
                break;
            }

            // ── batchImportContacts ────────────────────────────────────────────────
            case 'batchImportContacts': {
                const contacts = args[0] || [];
                let imported = 0;
                let errors = 0;
                for (const c of contacts) {
                    try {
                        const { rows } = await sql`
                  INSERT INTO contacts (name, company, designation, mobile, email, status, source, location, link, link2, response, poc_name, poc_phone, poc_designation, created_by)
                  VALUES (
                    ${c.name || ''}, ${c.company || ''}, ${c.designation || ''},
                    ${c.mobile || ''}, ${c.email || ''}, ${c.status || 'Contact'},
                    ${c.source || ''}, ${c.location || ''}, ${c.link || ''}, ${c.link2 || ''},
                    ${c.response || ''}, ${c.poc_name || ''}, ${c.poc_phone || ''}, ${c.poc_designation || ''}, ${userName || ''}
                  )
                  RETURNING id
                `;
                        if (userName && c.name) {
                            await sql`
                    INSERT INTO remarks (contact_id, contact_name, remark, created_by)
                    VALUES (${rows[0].id}, ${c.name || ''}, ${'Imported by ' + userName}, ${userName})
                  `;
                        }
                        imported++;
                    } catch (e) { errors++; }
                }
                result = { success: true, imported, errors };
                break;
            }

            // ── updateContactStatus ─────────────────────────────────────────────────
            case 'updateContactStatus': {
                const [id, status, remarkName] = args;
                const { rows: cur } = await sql`SELECT status, name, assigned_to FROM contacts WHERE id = ${id}`;
                const oldStatus = cur[0]?.status || '';
                const currentAssigned = cur[0]?.assigned_to || '';
                await sql`UPDATE contacts SET status = ${status}, status_updated_by = ${userName || ''}, status_updated_at = NOW() WHERE id = ${id}`;
                // Auto-assign when moving from New to another status
                if (oldStatus === 'Contact' && status !== 'Contact' && !currentAssigned && userName) {
                    await sql`UPDATE contacts SET assigned_to = ${userName} WHERE id = ${id}`;
                }
                if (userName && remarkName) {
                    await sql`
                INSERT INTO remarks (contact_id, contact_name, remark, created_by)
                VALUES (${id}, ${remarkName}, ${'Status changed to ' + status + ' by ' + userName}, ${userName})
              `;
                }
                result = { success: true };
                break;
            }

            // ── updateContactDetails ────────────────────────────────────────────────
            case 'updateContactDetails': {
                const c = args[0] || {};
                const remark = args[1] || '';
                await sql.query(`
              UPDATE contacts SET
                name = $1, company = $2, designation = $3, mobile = $4,
                email = $5, status = $6, source = $7, location = $8,
                link = $9, link2 = $10, response = $11, poc_name = $12, poc_phone = $13, poc_designation = $14,
                service_plan = $15, status_updated_by = $16, status_updated_at = NOW()
              WHERE id = $17
            `, [c.name || '', c.company || '', c.designation || '', c.mobile || '',
                    c.email || '', c.status || 'Contact', c.source || '', c.location || '',
                    c.link || '', c.link2 || '', c.response || '', c.poc_name || '', c.poc_phone || '', c.poc_designation || '', c.service_plan || '', userName || '', c.row]);
                if (remark && userName) {
                    await sql`
                INSERT INTO remarks (contact_id, contact_name, remark, created_by)
                VALUES (${c.row}, ${c.name || ''}, ${remark + ' by ' + userName}, ${userName})
              `;
                }
                result = { success: true };
                break;
            }

            // ── getDemoInquiry ──────────────────────────────────────────────────────
            case 'getDemoInquiry': {
                const [contactId] = args;
                const { rows } = await sql`SELECT * FROM demo_inquiries WHERE contact_id = ${contactId} LIMIT 1`;
                if (rows.length === 0) { result = null; break; }
                const r = rows[0];
                result = {
                    id: r.id,
                    contact_id: r.contact_id,
                    team_size: r.team_size || 0,
                    actively_hiring: r.actively_hiring || '',
                    dedicated_hr_team: r.dedicated_hr_team || '',
                    org_structure_defined: r.org_structure_defined || '',
                    roles_sops_documented: r.roles_sops_documented || '',
                    challenges: r.challenges || '',
                    created_by: r.created_by || '',
                    created_at: r.created_at,
                    updated_at: r.updated_at,
                };
                break;
            }

            // ── saveDemoInquiry ─────────────────────────────────────────────────────
            case 'saveDemoInquiry': {
                const d = args[0] || {};
                const contactId = d.contact_id;
                const teamSize = parseInt(d.team_size, 10) || 0;
                const activelyHiring = d.actively_hiring || '';
                const dedicatedHr = d.dedicated_hr_team || '';
                const orgStructure = d.org_structure_defined || '';
                const rolesSops = d.roles_sops_documented || '';
                const challenges = Array.isArray(d.challenges) ? d.challenges.join(', ') : (d.challenges || '');
                const { rows: existing } = await sql`SELECT id FROM demo_inquiries WHERE contact_id = ${contactId} LIMIT 1`;
                if (existing.length > 0) {
                    await sql.query(`
                      UPDATE demo_inquiries SET
                        team_size = $1, actively_hiring = $2, dedicated_hr_team = $3,
                        org_structure_defined = $4, roles_sops_documented = $5, challenges = $6,
                        updated_at = NOW()
                      WHERE contact_id = $7
                    `, [teamSize, activelyHiring, dedicatedHr, orgStructure, rolesSops, challenges, contactId]);
                } else {
                    await sql.query(`
                      INSERT INTO demo_inquiries (contact_id, team_size, actively_hiring, dedicated_hr_team, org_structure_defined, roles_sops_documented, challenges, created_by)
                      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                    `, [contactId, teamSize, activelyHiring, dedicatedHr, orgStructure, rolesSops, challenges, userName || '']);
                }
                result = { success: true };
                break;
            }

            // ── deleteContact ───────────────────────────────────────────────────────
            case 'deleteContact': {
                if (userRole === 'Executive' || userRole === 'Manager') return res.status(200).json({ result: null, error: 'Only admins can delete contacts' });
                const raw = args[0];
                const id = typeof raw === 'object' ? raw.id : raw;
                await sql`DELETE FROM contacts WHERE id = ${id}`;
                result = { success: true };
                break;
            }

            // ── deleteContactsByStatus ──────────────────────────────────────────────
            case 'deleteContactsByStatus': {
                if (userRole === 'Executive' || userRole === 'Manager') return res.status(200).json({ result: null, error: 'Only admins can delete contacts' });
                const [status] = args;
                await sql`DELETE FROM contacts WHERE status = ${status}`;
                result = { success: true };
                break;
            }

            // ── deleteContactsByIds ─────────────────────────────────────────────────
            case 'deleteContactsByIds': {
                if (userRole === 'Executive' || userRole === 'Manager') return res.status(200).json({ result: null, error: 'Only admins can delete contacts' });
                const ids = (args[0] || []).map(Number).filter(function (n) { return !isNaN(n); });
                if (ids.length === 0) { result = { success: true, deleted: 0 }; break; }
                await sql.query(`DELETE FROM contacts WHERE id = ANY($1::int[])`, [ids]);
                result = { success: true, deleted: ids.length };
                break;
            }

            // ── addRemark ───────────────────────────────────────────────────────────
            case 'addRemark': {
                const [contactId, contactName, remark, image] = args;
                await sql`
              INSERT INTO remarks (contact_id, contact_name, remark, image, created_by)
              VALUES (${contactId}, ${contactName || ''}, ${remark}, ${image || ''}, ${userName})
            `;
                result = { success: true };
                break;
            }

            // ── sendWhatsApp (Fast2SMS WhatsApp template) ───────────────────────────
            case 'sendWhatsApp': {
                const [mobile] = args;
                const apiKey = process.env.FAST2SMS_API_KEY;
                if (!apiKey) {
                    return res.status(200).json({ error: 'FAST2SMS_API_KEY not configured' });
                }
                // normalize to 10-digit Indian number
                let num = String(mobile || '').replace(/[^0-9]/g, '');
                if (num.length === 12 && num.startsWith('91')) num = num.slice(2);
                if (num.length !== 10) {
                    return res.status(200).json({ error: 'Invalid mobile number: ' + mobile });
                }
                let url = 'https://www.fast2sms.com/dev/whatsapp'
                    + '?authorization=' + encodeURIComponent(apiKey)
                    + '&message_id=' + encodeURIComponent(FAST2SMS_WA_MESSAGE_ID)
                    + '&phone_number_id=' + encodeURIComponent(FAST2SMS_WA_PHONE_NUMBER_ID)
                    + '&numbers=' + encodeURIComponent(num);
                const resp = await fetch(url);
                const text = await resp.text();
                let data;
                try { data = JSON.parse(text); } catch (e) { data = { raw: text }; }
                if (!resp.ok || data.return === false) {
                    return res.status(200).json({ error: (data && data.message) ? (Array.isArray(data.message) ? data.message.join(', ') : data.message) : ('Fast2SMS error: ' + text) });
                }
                result = { success: true, response: data };
                break;
            }

            // ── sendWhatsAppPDF (Fast2SMS WhatsApp PDF template) ───────────────────
            case 'sendWhatsAppPDF': {
                const [mobile] = args;
                const apiKey = process.env.FAST2SMS_API_KEY;
                if (!apiKey) {
                    return res.status(200).json({ error: 'FAST2SMS_API_KEY not configured' });
                }
                let num = String(mobile || '').replace(/[^0-9]/g, '');
                if (num.length === 12 && num.startsWith('91')) num = num.slice(2);
                if (num.length !== 10) {
                    return res.status(200).json({ error: 'Invalid mobile number: ' + mobile });
                }
                const pdfUrl = 'https://piplhr.sgp1.cdn.digitaloceanspaces.com/companies/48434c7b-931e-4af8-b944-748aaba4d181/files/20260727080342_a5f5bb15_Piplhr_Business_OS_compressed.pdf';
                let url = 'https://www.fast2sms.com/dev/whatsapp'
                    + '?authorization=' + encodeURIComponent(apiKey)
                    + '&message_id=' + encodeURIComponent(26848)
                    + '&phone_number_id=' + encodeURIComponent(FAST2SMS_WA_PHONE_NUMBER_ID)
                    + '&numbers=' + encodeURIComponent(num)
                    + '&media_url=' + encodeURIComponent(pdfUrl)
                    + '&document_filename=' + encodeURIComponent('Piplhr_Business_OS.pdf');
                const resp = await fetch(url);
                const text = await resp.text();
                let data;
                try { data = JSON.parse(text); } catch (e) { data = { raw: text }; }
                if (!resp.ok || data.return === false) {
                    return res.status(200).json({ error: (data && data.message) ? (Array.isArray(data.message) ? data.message.join(', ') : data.message) : ('Fast2SMS error: ' + text) });
                }
                result = { success: true, response: data };
                break;
            }

            // ── getRemarks (for one contact) ────────────────────────────────────────
            case 'getRemarks': {
                const [contactId] = args;
                const { rows } = await sql`
              SELECT * FROM remarks WHERE contact_id = ${contactId}
              ORDER BY created_at DESC
            `;
                result = rows.map(r => ({
                    contactRow: r.contact_id,
                    contactName: r.contact_name || '',
                    remark: r.remark || '',
                    image: r.image || '',
                    createdBy: r.created_by || '',
                    dateTime: r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString(),
                }));
                break;
            }

            // ── getAllRemarks ───────────────────────────────────────────────────────
            case 'getAllRemarks': {
                const { rows } = await sql.query(`
              SELECT r.*, c.status AS contact_status
              FROM remarks r
              LEFT JOIN contacts c ON r.contact_id = c.id
              ORDER BY r.created_at DESC
            `);
                result = rows.map(r => ({
                    contactRow: r.contact_id,
                    contactName: r.contact_name || '',
                    remark: r.remark || '',
                    image: r.image || '',
                    createdBy: r.created_by || '',
                    contactStatus: r.contact_status || '',
                    dateTime: r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString(),
                }));
                break;
            }

            // ── addReminder ─────────────────────────────────────────────────────────
            case 'addReminder': {
                const rem = args[0] || {};
                const { rows } = await sql`
              INSERT INTO reminders (contact_id, contact_name, type, date, time, agenda, meeting_location, map_link, user_name, guest_user_name, status, created_by)
              VALUES (
                ${rem.contactRow || 0}, ${rem.contactName || ''},
                ${rem.type || 'Phone'}, ${rem.date || ''}, ${rem.time || ''},
                ${rem.agenda || ''}, ${rem.meeting_location || ''}, ${rem.map_link || ''}, ${rem.user_name || ''}, ${rem.guest_user_name || ''},
                ${rem.status || 'Pending'}, ${userName}
              )
              RETURNING id
            `;
                if (userName && rem.contactName) {
                    await sql`
                  INSERT INTO remarks (contact_id, contact_name, remark, created_by)
                  VALUES (${rem.contactRow || 0}, ${rem.contactName || ''}, ${'Reminder created (' + (rem.type || 'Phone') + '): ' + (rem.date || '') + ' ' + (rem.time || '') + ' - ' + (rem.agenda || '') + ' by ' + userName}, ${userName})
                `;
                }
                result = { success: true, id: rows[0].id };
                break;
            }

            // ── getAllReminders ─────────────────────────────────────────────────────
            case 'getAllReminders': {
                const { rows } = await sql`
              SELECT * FROM reminders ORDER BY
                CASE WHEN status != 'Completed' THEN 0 ELSE 1 END,
                date ASC, time ASC
            `;
                result = rows.map(r => ({
                    id: r.id,
                    contactRow: r.contact_id,
                    contactName: r.contact_name || '',
                    type: r.type || 'Phone',
                    date: r.date || '',
                    time: r.time || '',
                    agenda: r.agenda || '',
                    meeting_location: r.meeting_location || '',
                    map_link: r.map_link || '',
                    user_name: r.user_name || '',
                    guest_user_name: r.guest_user_name || '',
                    status: r.status || 'Pending',
                    createdBy: r.created_by || '',
                    createdAt: r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString(),
                }));
                break;
            }

            // ── getRemindersForContact ──────────────────────────────────────────────
            case 'getRemindersForContact': {
                const [contactId] = args;
                const { rows } = await sql`
              SELECT * FROM reminders WHERE contact_id = ${contactId}
              ORDER BY date ASC, time ASC
            `;
                result = rows.map(r => ({
                    id: r.id,
                    contactRow: r.contact_id,
                    contactName: r.contact_name || '',
                    type: r.type || 'Phone',
                    date: r.date || '',
                    time: r.time || '',
                    agenda: r.agenda || '',
                    meeting_location: r.meeting_location || '',
                    map_link: r.map_link || '',
                    user_name: r.user_name || '',
                    guest_user_name: r.guest_user_name || '',
                    status: r.status || 'Pending',
                    createdBy: r.created_by || '',
                    createdAt: r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString(),
                }));
                break;
            }

            // ── updateReminderStatus ────────────────────────────────────────────────
            case 'updateReminderStatus': {
                const [id, status] = args;
                await sql`UPDATE reminders SET status = ${status} WHERE id = ${id}`;
                result = { success: true };
                break;
            }

            // ── deleteReminder ──────────────────────────────────────────────────────
            case 'deleteReminder': {
                const [id] = args;
                await sql`DELETE FROM reminders WHERE id = ${id}`;
                result = { success: true };
                break;
            }

            // ── updateReminder ──────────────────────────────────────────────────────
            case 'updateReminder': {
                const rem = args[0] || {};
                await sql.query(`
              UPDATE reminders SET
                type = $1, date = $2, time = $3, agenda = $4,
                meeting_location = $5, map_link = $6, user_name = $7, guest_user_name = $8
              WHERE id = $9
            `, [rem.type || 'Phone', rem.date || '', rem.time || '', rem.agenda || '',
                    rem.meeting_location || '', rem.map_link || '', rem.user_name || '', rem.guest_user_name || '', rem.id]);
                result = { success: true };
                break;
            }

            // ── assignContact ───────────────────────────────────────────────────────
            case 'assignContact': {
                if (userRole === 'Executive') return res.status(200).json({ result: null, error: 'Only Admin and Manager can assign contacts' });
                const [contactId, assignedTo] = args;
                await sql`UPDATE contacts SET assigned_to = ${assignedTo || ''} WHERE id = ${contactId}`;
                if (userName && assignedTo) {
                    const { rows } = await sql`SELECT name FROM contacts WHERE id = ${contactId}`;
                    const cName = rows[0]?.name || '';
                    await sql`
                  INSERT INTO remarks (contact_id, contact_name, remark, created_by)
                  VALUES (${contactId}, ${cName}, ${'Assigned to ' + assignedTo + ' by ' + userName}, ${userName})
                `;
                }
                result = { success: true };
                break;
            }

            // ── findDuplicates ─────────────────────────────────────────────────────
            case 'findDuplicates': {
                const { rows } = await sql`
              SELECT c.*,
                COALESCE(rk.cnt, 0) AS remark_count,
                COALESCE(rm.cnt, 0) AS reminder_count
              FROM contacts c
              LEFT JOIN (SELECT contact_id, COUNT(*) AS cnt FROM remarks GROUP BY contact_id) rk ON rk.contact_id = c.id
              LEFT JOIN (SELECT contact_id, COUNT(*) AS cnt FROM reminders GROUP BY contact_id) rm ON rm.contact_id = c.id
              ORDER BY c.name ASC
            `;
                const groups = [];
                const seen = new Set();

                // Group by normalized name
                const nameMap = {};
                const mobileMap = {};
                const companyMap = {};

                for (const r of rows) {
                    const name = (r.name || '').trim().toLowerCase();
                    const mobile = (r.mobile || '').replace(/[^0-9]/g, '');
                    const company = (r.company || '').trim().toLowerCase();

                    if (name) {
                        if (!nameMap[name]) nameMap[name] = [];
                        nameMap[name].push(r);
                    }
                    if (mobile && mobile.length >= 6) {
                        if (!mobileMap[mobile]) mobileMap[mobile] = [];
                        mobileMap[mobile].push(r);
                    }
                    if (company) {
                        if (!companyMap[company]) companyMap[company] = [];
                        companyMap[company].push(r);
                    }
                }

                function addGroup(list, reason) {
                    if (list.length < 2) return;
                    const ids = list.map(c => c.id).sort().join(',');
                    if (seen.has(ids)) return;
                    seen.add(ids);
                    groups.push({ reason, contacts: list.map(c => ({ id: c.id, name: c.name, company: c.company, mobile: c.mobile, email: c.email, status: c.status, source: c.source, location: c.location, designation: c.designation, link: c.link, remark_count: c.remark_count, reminder_count: c.reminder_count })) });
                }

                for (const g of Object.values(nameMap)) {
                    // split same-name group by mobile — if mobiles differ they're likely different people
                    const byMobile = {};
                    const noMobile = [];
                    for (const c of g) {
                        const m = (c.mobile || '').replace(/[^0-9]/g, '');
                        if (m) { if (!byMobile[m]) byMobile[m] = []; byMobile[m].push(c); }
                        else noMobile.push(c);
                    }
                    // include no-mobile contacts in every mobile group so they still get caught
                    for (const sub of Object.values(byMobile)) addGroup(sub.concat(noMobile), 'Same Name');
                    if (noMobile.length >= 2) addGroup(noMobile, 'Same Name');
                }
                for (const g of Object.values(mobileMap)) addGroup(g, 'Same Mobile');
                for (const g of Object.values(companyMap)) addGroup(g, 'Same Company');

                result = groups;
                break;
            }

            // ── mergeContacts ───────────────────────────────────────────────────────
            case 'mergeContacts': {
                if (userRole !== 'Admin') return res.status(200).json({ result: null, error: 'Only admins can merge contacts' });
                const { keepId, mergeIds } = args[0] || {};
                if (!keepId || !mergeIds || !mergeIds.length) {
                    return res.status(200).json({ result: null, error: 'keepId and mergeIds required' });
                }
                for (const id of mergeIds) {
                    await sql`UPDATE remarks SET contact_id = ${keepId} WHERE contact_id = ${id}`;
                    await sql`UPDATE reminders SET contact_id = ${keepId} WHERE contact_id = ${id}`;
                    await sql`DELETE FROM contacts WHERE id = ${id}`;
                }
                const { rows } = await sql`SELECT * FROM contacts WHERE id = ${keepId}`;
                if (rows.length > 0 && userName) {
                    await sql`
                  INSERT INTO remarks (contact_id, contact_name, remark, created_by)
                  VALUES (${keepId}, ${rows[0].name || ''}, ${'Merged ' + mergeIds.length + ' duplicate(s) into this contact by ' + userName}, ${userName})
                `;
                }
                result = { success: true };
                break;
            }

            // ── signupWebhook ────────────────────────────────────────────────────────
            case 'signupWebhook': {
                const d = args[0] || {};
                const email = (d.email || '').trim();
                const mobile = (d.mobile || '').trim();

                // Stages a real signup is allowed to advance FROM. A signup means the
                // person actually registered, so anyone still in the early pipeline is
                // promoted to 'Registration'. Outcome/terminal stages (Registration
                // itself, Won, Nurture, Cancelled, Expired) are left untouched so we
                // never regress a real result back to 'Registration'.
                const PROMOTABLE_TO_REGISTRATION = ['Contact', 'Meeting', 'Confirmation', 'Sales Order', 'Receive'];

                // Dedup: signup may be retried (auto-retried request, double submit) and
                // the contact may already exist because sales created it manually. If a
                // contact already exists by email or mobile, update it in place (and move
                // it to 'Registration') instead of inserting a duplicate. Email match
                // takes priority over mobile.
                const { rows: dup } = await sql`
              SELECT id, name, mobile, email, designation, company, status
              FROM contacts
              WHERE (${email} <> '' AND email = ${email})
                 OR (${mobile} <> '' AND mobile = ${mobile})
              ORDER BY (CASE WHEN ${email} <> '' AND email = ${email} THEN 0 ELSE 1 END)
              LIMIT 1
            `;

                if (dup.length > 0) {
                    const contact = dup[0];
                    const promote = PROMOTABLE_TO_REGISTRATION.includes(contact.status);
                    const newStatus = promote ? 'Contact' : contact.status;
                    await sql`
              UPDATE contacts SET
                name = COALESCE(${d.name || null}, name),
                company = COALESCE(${d.company || null}, company),
                designation = COALESCE(${d.designation || null}, designation),
                mobile = COALESCE(${mobile || null}, mobile),
                email = COALESCE(${email || null}, email),
                status = ${newStatus},
                status_updated_by = CASE WHEN ${promote} THEN 'Webhook' ELSE status_updated_by END,
                status_updated_at = CASE WHEN ${promote} THEN NOW() ELSE status_updated_at END
              WHERE id = ${contact.id}
            `;
                    const remark = promote
                        ? 'Signup webhook matched existing contact; details refreshed and moved ' + (contact.status || 'Contact') + ' → Contact'
                        : 'Signup webhook matched existing contact; details refreshed (status ' + (contact.status || 'Leads') + ' kept)';
                    await sql`
              INSERT INTO remarks (contact_id, contact_name, remark, created_by)
              VALUES (${contact.id}, ${d.name || contact.name || ''}, ${remark}, 'Webhook')
            `;
                    result = { success: true, id: contact.id, deduped: true, status: newStatus };
                    break;
                }

                const { rows } = await sql`
              INSERT INTO contacts (name, company, designation, mobile, email, status, source, response, poc_name, poc_phone, poc_designation, created_by, status_updated_by, status_updated_at)
              VALUES (${d.name || ''}, ${d.company || ''}, ${d.designation || ''}, ${mobile}, ${email}, 'Contact', 'Signup', '', '', '', '', 'Webhook', 'Webhook', NOW())
              RETURNING id
            `;
                const contactId = rows[0].id;
                await sql`
              INSERT INTO remarks (contact_id, contact_name, remark, created_by)
              VALUES (${contactId}, ${d.name || ''}, 'Contact auto-created via signup webhook', 'Webhook')
            `;
                result = { success: true, id: contactId };
                break;
            }

            // ── contactusWebhook ────────────────────────────────────────────────────
            case 'contactusWebhook': {
                const d = args[0] || {};
                const { rows } = await sql`
              INSERT INTO contacts (name, company, designation, mobile, email, status, source, response, poc_name, poc_phone, poc_designation, created_by, status_updated_by, status_updated_at)
              VALUES (${d.name || ''}, ${d.company || ''}, ${d.designation || ''}, ${d.mobile || ''}, ${d.email || ''}, 'Contact', 'Contact-us', '', '', '', '', 'Webhook', 'Webhook', NOW())
              RETURNING id
            `;
                const contactId = rows[0].id;
                await sql`
              INSERT INTO remarks (contact_id, contact_name, remark, created_by)
              VALUES (${contactId}, ${d.name || ''}, 'Contact auto-created via contact-us webhook', 'Webhook')
            `;
                result = { success: true, id: contactId };
                break;
            }

            // ── signupUpdateWebhook ───────────────────────────────────────────────────
            case 'signupUpdateWebhook': {
                const d = args[0] || {};
                const email = (d.email || '').trim();
                const mobile = (d.mobile || '').trim();
                if (!email && !mobile)
                    return res.status(200).json({ result: null, error: 'email or mobile is required to find the contact' });

                // Match by email first, then by mobile. This lets a phone-only contact
                // gain an email (matched on mobile) and an email-only contact gain a
                // phone (matched on email) — the "phone↔email" client update case.
                const { rows: existing } = await sql`
              SELECT id, name, mobile, email, designation, company
              FROM contacts
              WHERE (${email} <> '' AND email = ${email})
                 OR (${mobile} <> '' AND mobile = ${mobile})
              ORDER BY (CASE WHEN ${email} <> '' AND email = ${email} THEN 0 ELSE 1 END)
              LIMIT 1
            `;
                if (existing.length === 0)
                    return res.status(200).json({ result: null, error: 'No contact found by email or mobile' });
                const contact = existing[0];
                const changes = [];
                if (mobile && mobile !== contact.mobile) changes.push('Mobile: ' + (contact.mobile || '(empty)') + ' → ' + mobile);
                if (email && email !== contact.email) changes.push('Email: ' + (contact.email || '(empty)') + ' → ' + email);
                if (d.designation && d.designation !== contact.designation) changes.push('Designation: ' + (contact.designation || '(empty)') + ' → ' + d.designation);
                if (d.name && d.name !== contact.name) changes.push('Name: ' + (contact.name || '(empty)') + ' → ' + d.name);
                if (d.company && d.company !== contact.company) changes.push('Company: ' + (contact.company || '(empty)') + ' → ' + d.company);
                if (changes.length === 0) {
                    result = { success: true, updated: false, message: 'No changes detected' };
                    break;
                }
                await sql`
              UPDATE contacts SET
                name = COALESCE(${d.name || null}, name),
                company = COALESCE(${d.company || null}, company),
                mobile = COALESCE(${mobile || null}, mobile),
                email = COALESCE(${email || null}, email),
                designation = COALESCE(${d.designation || null}, designation)
              WHERE id = ${contact.id}
            `;
                await sql`
              INSERT INTO remarks (contact_id, contact_name, remark, created_by)
              VALUES (${contact.id}, ${d.name || contact.name || ''}, ${'Signup profile updated: ' + changes.join('; ')}, 'Webhook')
            `;
                result = { success: true, updated: true, changes };
                break;
            }

            // ── stageWebhook ──────────────────────────────────────────────────────────
            // Lifecycle stage move driven by the app (e.g. payment success → 'Won',
            // subscription expired → 'Expired'). Finds the contact by email/mobile and
            // sets its status. If no contact matches, a new one is created in that stage
            // so offline / never-registered customers are still tracked.
            case 'stageWebhook': {
                const d = args[0] || {};
                const email = (d.email || '').trim();
                const mobile = (d.mobile || '').trim();
                const status = (d.status || '').trim();

                if (!email && !mobile)
                    return res.status(200).json({ result: null, error: 'email or mobile is required to find the contact' });
                if (!STATUSES.includes(status))
                    return res.status(200).json({ result: null, error: 'Invalid status: ' + status });

                const { rows: existing } = await sql`
              SELECT id, name, mobile, email, designation, company, status
              FROM contacts
              WHERE (${email} <> '' AND email = ${email})
                 OR (${mobile} <> '' AND mobile = ${mobile})
              ORDER BY (CASE WHEN ${email} <> '' AND email = ${email} THEN 0 ELSE 1 END)
              LIMIT 1
            `;

                if (existing.length > 0) {
                    const contact = existing[0];
                    if (contact.status === status) {
                        result = { success: true, id: contact.id, updated: false, status };
                        break;
                    }
                    await sql`
              UPDATE contacts SET
                name = COALESCE(${d.name || null}, name),
                company = COALESCE(${d.company || null}, company),
                designation = COALESCE(${d.designation || null}, designation),
                mobile = COALESCE(${mobile || null}, mobile),
                email = COALESCE(${email || null}, email),
                status = ${status},
                status_updated_by = 'Webhook',
                status_updated_at = NOW()
              WHERE id = ${contact.id}
            `;
                    await sql`
              INSERT INTO remarks (contact_id, contact_name, remark, created_by)
              VALUES (${contact.id}, ${d.name || contact.name || ''}, ${'Stage moved ' + (contact.status || 'Leads') + ' → ' + status + ' via webhook'}, 'Webhook')
            `;
                    result = { success: true, id: contact.id, updated: true, status };
                    break;
                }

                const { rows } = await sql`
              INSERT INTO contacts (name, company, designation, mobile, email, status, source, response, created_by, status_updated_by, status_updated_at)
              VALUES (${d.name || ''}, ${d.company || ''}, ${d.designation || ''}, ${mobile}, ${email}, ${status}, ${d.source || 'Signup'}, '', 'Webhook', 'Webhook', NOW())
              RETURNING id
            `;
                const newId = rows[0].id;
                await sql`
              INSERT INTO remarks (contact_id, contact_name, remark, created_by)
              VALUES (${newId}, ${d.name || ''}, ${'Contact auto-created via stage webhook in stage ' + status}, 'Webhook')
            `;
                result = { success: true, id: newId, created: true, status };
                break;
            }

            // ── getServicePlans ──────────────────────────────────────────────────────
            case 'getServicePlans': {
                const { rows } = await sql`SELECT * FROM service_plans ORDER BY id`;
                result = rows.map(r => ({
                    id: r.id,
                    name: r.name || '',
                    price: r.price || '',
                    billing: r.billing || '',
                    features: r.features || '',
                }));
                break;
            }

            default:
                return res.status(400).json({ error: 'Unknown function: ' + fn });
        }

        res.status(200).json({ result });

    } catch (err) {
        console.error(`CRM [${fn}] error:`, err);
        res.status(500).json({ error: err.message });
    }
};
