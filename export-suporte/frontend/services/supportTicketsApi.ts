/**
 * API de tickets de suporte (isolado de api.ts para deploy simples: copiar este ficheiro + reexports em api.ts).
 */
const API_BASE = '/api';

let refreshInFlight: Promise<boolean> | null = null;

async function tryRefreshSessionOnce(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, { method: 'POST', credentials: 'include' });
      return res.ok;
    } catch {
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
};

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
  try {
    const res = await apiFetch(`${API_BASE}/support/mutate`, { method: 'POST', body: fd });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; id?: string; error?: string };
    if (!res.ok) return { ok: false, error: data.error || `HTTP ${res.status}` };
    return { ok: true, id: data.id };
  } catch {
    return { ok: false, error: 'Network error' };
  }
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
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; id?: string; error?: string };
    if (!res.ok) return { ok: false, error: data.error || `HTTP ${res.status}` };
    return { ok: true, id: data.id };
  } catch {
    return { ok: false, error: 'Network error' };
  }
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
