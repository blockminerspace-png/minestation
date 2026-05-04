/**
 * Referência: rotas de backend/server.js (integrar no ficheiro real).
 * Variáveis esperadas: app, db, crypto, path, authenticateToken, isAdmin,
 * uploadSupport, uploadSupportReply, SUPPORT_ALLOWED_EXT, appendGameActivityLog
 */

// --- SUPORTE (tickets com anexos foto/vídeo) ---
app.post('/api/support/submit', authenticateToken, (req, res, next) => {
  uploadSupport.array('files', 5)(req, res, (err) => {
    if (err) {
      const msg = err.message || 'Erro no upload';
      return res.status(400).json({ error: msg });
    }
    next();
  });
}, async (req, res) => {
  const uid = req.userId;
  if (!uid) return res.status(401).json({ error: 'Não autenticado' });
  const subjectRaw = req.body?.subject != null ? String(req.body.subject) : '';
  const messageRaw = req.body?.message != null ? String(req.body.message) : '';
  const subject = subjectRaw.trim().slice(0, 180);
  const message = messageRaw.trim().slice(0, 8000);
  if (subject.length < 3) return res.status(400).json({ error: 'Assunto demasiado curto (mín. 3 caracteres).' });
  if (message.length < 10) return res.status(400).json({ error: 'Mensagem demasiado curta (mín. 10 caracteres).' });
  const files = Array.isArray(req.files) ? req.files : [];
  const attachments = [];
  for (const f of files) {
    if (!f || !f.filename) continue;
    const ext = path.extname(f.filename).toLowerCase();
    if (!SUPPORT_ALLOWED_EXT.has(ext)) continue;
    attachments.push({
      url: `/img/${f.filename}`,
      originalName: String(f.originalname || f.filename).slice(0, 200),
      mime: String(f.mimetype || '').slice(0, 120),
    });
  }
  const id = crypto.randomUUID();
  const now = Date.now();
  try {
    await db.query(
      `INSERT INTO support_tickets (id, user_id, subject, message, attachments, status, created_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, 'open', $6)`,
      [id, uid, subject, message, JSON.stringify(attachments), now]
    );
    await appendGameActivityLog(db, uid, 'support_ticket_submit', { ticketId: id, attachmentCount: attachments.length });
    res.json({ ok: true, id });
  } catch (e) {
    console.error('[POST /api/support/submit]', e);
    res.status(500).json({ error: 'Erro ao registar o pedido.' });
  }
});

app.get('/api/admin/support-tickets', isAdmin, async (req, res) => {
  try {
    const limit = Math.min(300, Math.max(1, parseInt(String(req.query.limit || '100'), 10) || 100));
    const rowsRes = await db.query(
      `SELECT t.id, t.user_id, t.subject, t.message, t.attachments, t.status, t.created_at,
              u.username, u.email
       FROM support_tickets t
       JOIN users u ON u.id = t.user_id
       ORDER BY t.created_at DESC
       LIMIT $1`,
      [limit]
    );
    const ids = rowsRes.rows.map((r) => r.id);
    const repliesByTicket = {};
    if (ids.length > 0) {
      const repRes = await db.query(
        `SELECT r.id, r.ticket_id, r.admin_user_id, r.message, r.attachments, r.created_at,
                au.username AS admin_username
         FROM support_ticket_replies r
         JOIN users au ON au.id = r.admin_user_id
         WHERE r.ticket_id = ANY($1::text[])
         ORDER BY r.created_at ASC`,
        [ids]
      );
      for (const row of repRes.rows) {
        const tid = row.ticket_id;
        if (!repliesByTicket[tid]) repliesByTicket[tid] = [];
        const att = Array.isArray(row.attachments) ? row.attachments : [];
        repliesByTicket[tid].push({
          id: row.id,
          adminUserId: row.admin_user_id,
          adminUsername: row.admin_username,
          message: row.message,
          attachments: att,
          createdAt: row.created_at,
        });
      }
    }
    const rows = rowsRes.rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      username: r.username,
      email: r.email,
      subject: r.subject,
      message: r.message,
      attachments: Array.isArray(r.attachments) ? r.attachments : [],
      status: r.status,
      createdAt: r.created_at,
      replies: repliesByTicket[r.id] || [],
    }));
    res.json({ tickets: rows });
  } catch (e) {
    console.error('[GET /api/admin/support-tickets]', e);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/admin/support-tickets/status', isAdmin, async (req, res) => {
  const { id, status } = req.body || {};
  if (!id || typeof id !== 'string') return res.status(400).json({ error: 'id obrigatório.' });
  const st = status === 'archived' ? 'archived' : 'open';
  try {
    const r = await db.query('UPDATE support_tickets SET status = $1 WHERE id = $2 RETURNING id', [st, id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Ticket não encontrado.' });
    res.json({ ok: true });
  } catch (e) {
    console.error('[POST /api/admin/support-tickets/status]', e);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/admin/support-tickets/reply', isAdmin, (req, res, next) => {
  uploadSupportReply.array('files', 5)(req, res, (err) => {
    if (err) {
      const msg = err.message || 'Erro no upload';
      return res.status(400).json({ error: msg });
    }
    next();
  });
}, async (req, res) => {
  const adminId = req.userId;
  if (!adminId) return res.status(401).json({ error: 'Não autenticado' });
  const ticketIdRaw = req.body?.ticketId != null ? String(req.body.ticketId) : '';
  const ticketId = ticketIdRaw.trim().slice(0, 80);
  if (!ticketId) return res.status(400).json({ error: 'ticketId obrigatório.' });
  const messageRaw = req.body?.message != null ? String(req.body.message) : '';
  const message = messageRaw.trim().slice(0, 8000);
  const files = Array.isArray(req.files) ? req.files : [];
  if (message.length < 3 && files.length === 0) {
    return res.status(400).json({ error: 'Escreva uma mensagem (mín. 3 caracteres) ou anexe ficheiros.' });
  }
  const attachments = [];
  for (const f of files) {
    if (!f || !f.filename) continue;
    const ext = path.extname(f.filename).toLowerCase();
    if (!SUPPORT_ALLOWED_EXT.has(ext)) continue;
    attachments.push({
      url: `/img/${f.filename}`,
      originalName: String(f.originalname || f.filename).slice(0, 200),
      mime: String(f.mimetype || '').slice(0, 120),
    });
  }
  try {
    const tRes = await db.query('SELECT id, user_id FROM support_tickets WHERE id = $1', [ticketId]);
    const t = tRes.rows[0];
    if (!t) return res.status(404).json({ error: 'Ticket não encontrado.' });
    const replyId = crypto.randomUUID();
    const now = Date.now();
    await db.query(
      `INSERT INTO support_ticket_replies (id, ticket_id, admin_user_id, message, attachments, created_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
      [replyId, ticketId, adminId, message, JSON.stringify(attachments), now]
    );
    await appendGameActivityLog(db, t.user_id, 'support_ticket_admin_reply', {
      ticketId,
      replyId,
      adminUserId: adminId,
      attachmentCount: attachments.length,
    });
    res.json({ ok: true, id: replyId });
  } catch (e) {
    console.error('[POST /api/admin/support-tickets/reply]', e);
    res.status(500).json({ error: 'Erro ao registar a resposta.' });
  }
});
