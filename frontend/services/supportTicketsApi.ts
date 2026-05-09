/**
 * API de tickets de suporte (isolado de api.ts para deploy simples: copiar este ficheiro + reexports em api.ts).
 */
const API_BASE = '/api';
const SESSION_HINT_KEY = 'genesis_has_session';

const SUPPORT_PAYLOAD_TOO_LARGE_PT =
  'Os anexos excedem o limite permitido. Cada ficheiro pode ter até 12 MB (até 5 anexos). Tenta comprimir ou enviar menos ficheiros.';

function supportErrorFromJson(res: Response, data: Record<string, unknown>): string {
  if (res.status === 413) return SUPPORT_PAYLOAD_TOO_LARGE_PT;
  const err = data.error;
  if (typeof err === 'string' && err.trim()) return err;
  return `HTTP ${res.status}`;
}

let refreshInFlight: Promise<boolean> | null = null;

function getSessionHint(): boolean {
  try {
    return window.localStorage.getItem(SESSION_HINT_KEY) === '1';
  } catch {
    return false;
  }
}

function setSessionHint(enabled: boolean): void {
  try {
    if (enabled) window.localStorage.setItem(SESSION_HINT_KEY, '1');
    else window.localStorage.removeItem(SESSION_HINT_KEY);
  } catch {
    /* ignore */
  }
}

async function tryRefreshSessionOnce(): Promise<boolean> {
  if (!getSessionHint()) return false;
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, { method: 'POST', credentials: 'include' });
      if (!res.ok) setSessionHint(false);
      return res.ok;
    } catch {
      setSessionHint(false);
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

async function apiFetch(url: string, options: RequestInit = {}, allowRefreshRetry = true): Promise<Response> {
  const res = await fetch(url, { ...options, credentials: 'include' });
  if (res.status === 401 && allowRefreshRetry && !url.includes('/auth/refresh')) {
    const refreshed = await tryRefreshSessionOnce();
    if (refreshed) {
      return fetch(url, { ...options, credentials: 'include' });
    }
  }
  return res;
}

export type SupportTicketAttachment = { url: string; originalName: string; mime: string };

export type SupportTicketReplyRow = {
  id: string;
  adminUserId: number;
  adminUsername: string;
  message: string;
  attachments: SupportTicketAttachment[];
  createdAt: number;
};

export type SupportTicketPlayerReplyRow = {
  id: string;
  message: string;
  attachments: SupportTicketAttachment[];
  createdAt: number;
};

export type SupportTicketRow = {
  id: string;
  userId: number;
  username: string;
  email: string;
  subject: string;
  message: string;
  attachments: SupportTicketAttachment[];
  status: string;
  createdAt: number;
  replies: SupportTicketReplyRow[];
  playerReplies?: SupportTicketPlayerReplyRow[];
};

export type MySupportTicketSummary = {
  id: string;
  subject: string;
  status: string;
  createdAt: number;
  adminReplyCount: number;
  lastActivityAt: number;
};

export type MySupportTicketDetail = {
  ticket: {
    id: string;
    subject: string;
    message: string;
    attachments: SupportTicketAttachment[];
    status: string;
    createdAt: number;
  };
  adminReplies: Array<{
    id: string;
    adminUsername: string;
    message: string;
    attachments: SupportTicketAttachment[];
    createdAt: number;
  }>;
  playerReplies: SupportTicketPlayerReplyRow[];
};

/** `multipart/form-data` com `action` (`submit_ticket` | `player_reply`). */
export async function postSupportMutate(
  fd: FormData
): Promise<{ ok: boolean; id?: string; error?: string; code?: string }> {
  try {
    const res = await apiFetch(`${API_BASE}/support/mutate`, { method: 'POST', body: fd });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return {
        ok: false,
        error: supportErrorFromJson(res, data),
        code: typeof data.code === 'string' ? data.code : undefined
      };
    }
    const id = typeof data.id === 'string' ? data.id : undefined;
    return { ok: true, id };
  } catch {
    return { ok: false, error: 'Network error' };
  }
}

export async function submitSupportTicket(payload: {
  subject: string;
  message: string;
  files?: File[];
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  const fd = new FormData();
  fd.set('action', 'submit_ticket');
  fd.set('subject', payload.subject);
  fd.set('message', payload.message);
  for (const f of payload.files || []) {
    if (f && f.size > 0) fd.append('files', f);
  }
  return postSupportMutate(fd);
}

export async function getAdminSupportTickets(): Promise<{ tickets: SupportTicketRow[] }> {
  const res = await apiFetch(`${API_BASE}/admin/support-tickets`);
  if (!res.ok) return { tickets: [] };
  try {
    const data = (await res.json()) as { tickets?: SupportTicketRow[] };
    const raw = Array.isArray(data.tickets) ? data.tickets : [];
    const tickets = raw.map((t) => ({
      ...t,
      replies: Array.isArray(t.replies) ? t.replies : [],
      playerReplies: Array.isArray(t.playerReplies) ? t.playerReplies : [],
      attachments: Array.isArray(t.attachments) ? t.attachments : [],
    }));
    return { tickets };
  } catch {
    return { tickets: [] };
  }
}

export async function postAdminSupportTicketReply(payload: {
  ticketId: string;
  message: string;
  files?: File[];
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  const fd = new FormData();
  fd.set('ticketId', payload.ticketId);
  fd.set('message', payload.message);
  for (const f of payload.files || []) {
    if (f && f.size > 0) fd.append('files', f);
  }
  try {
    const res = await apiFetch(`${API_BASE}/admin/support-tickets/reply`, { method: 'POST', body: fd });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { ok: false, error: supportErrorFromJson(res, data) };
    return { ok: true, id: typeof data.id === 'string' ? data.id : undefined };
  } catch {
    return { ok: false, error: 'Network error' };
  }
}

export async function getMySupportTickets(): Promise<{ tickets: MySupportTicketSummary[] }> {
  const res = await apiFetch(`${API_BASE}/support/my-tickets`);
  if (!res.ok) return { tickets: [] };
  try {
    const data = (await res.json()) as { tickets?: MySupportTicketSummary[] };
    return { tickets: Array.isArray(data.tickets) ? data.tickets : [] };
  } catch {
    return { tickets: [] };
  }
}

export async function getMySupportTicketDetail(ticketId: string): Promise<MySupportTicketDetail | null> {
  const res = await apiFetch(`${API_BASE}/support/tickets/${encodeURIComponent(ticketId)}`);
  if (!res.ok) return null;
  try {
    const data = (await res.json()) as MySupportTicketDetail;
    if (!data?.ticket?.id) return null;
    return {
      ticket: data.ticket,
      adminReplies: Array.isArray(data.adminReplies) ? data.adminReplies : [],
      playerReplies: Array.isArray(data.playerReplies) ? data.playerReplies : [],
    };
  } catch {
    return null;
  }
}

export async function postPlayerSupportTicketReply(payload: {
  ticketId: string;
  message: string;
  files?: File[];
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  const fd = new FormData();
  fd.set('action', 'player_reply');
  fd.set('ticketId', payload.ticketId);
  fd.set('message', payload.message);
  for (const f of payload.files || []) {
    if (f && f.size > 0) fd.append('files', f);
  }
  return postSupportMutate(fd);
}

export async function updateAdminSupportTicketStatus(
  id: string,
  status: 'open' | 'archived'
): Promise<{ ok: boolean; error?: string }> {
  const res = await apiFetch(`${API_BASE}/admin/support-tickets/status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, status }),
  });
  try {
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok) return { ok: false, error: data.error || `HTTP ${res.status}` };
    return { ok: !!data.ok };
  } catch {
    return { ok: false, error: 'Network error' };
  }
}
