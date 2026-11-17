// Every call from the browser to our backend goes through here, so a failure is handled the
// same way on every screen: a clear message, never a blank page.

let onSignedOut = null;

export function setSignedOutHandler(handler) {
  onSignedOut = handler;
}

async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(path, { ...options, credentials: 'same-origin' });
  } catch {
    throw new Error('Could not reach the backend. Check that it is running.');
  }

  if (response.status === 401 && !path.endsWith('/login')) {
    if (onSignedOut) onSignedOut();
    throw new Error('Your session has ended. Please sign in again.');
  }

  if (!response.ok) {
    let message = `The backend replied with status ${response.status}`;
    try {
      const body = await response.json();
      if (body && body.error) message = body.error;
    } catch {
      // not JSON
    }
    throw new Error(message);
  }

  try {
    return await response.json();
  } catch {
    throw new Error('The backend sent a reply that was not readable.');
  }
}

function post(path, body) {
  return request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
}

const enc = encodeURIComponent;

export const api = {
  login: (username, password) => post('/api/login', { username, password }),
  logout: () => post('/api/logout'),
  session: () => request('/api/session'),
  dashboard: () => request('/api/dashboard'),
  actionLog: () => request('/api/action-log'),

  approve: (kind, id, note) => post(`/api/approvals/${enc(kind)}/${enc(id)}/approve`, { note }),
  reject: (kind, id, note) => post(`/api/approvals/${enc(kind)}/${enc(id)}/reject`, { note }),
  remindCfo: (kind, id) => post(`/api/approvals/${enc(kind)}/${enc(id)}/remind`),

  fixProblem: (id, note) => post(`/api/problems/${enc(id)}/fix`, { note }),

  setTaskStatus: (id, status, note) => post(`/api/close/${enc(id)}/status`, { status, note }),
  nudgeTask: (id) => post(`/api/close/${enc(id)}/nudge`),

  remindCustomer: (id, level) => post(`/api/customers/${enc(id)}/remind`, { level }),
  recordPromise: (id, amount, date, note) => post(`/api/customers/${enc(id)}/promise`, { amount, date, note }),

  assistantStatus: () => request('/api/assistant/status'),
  assistantOpeners: () => request('/api/assistant/openers'),
  assistantAsk: (question, filter) => post('/api/assistant/ask', { question, filter }),
  assistantConfirm: (approved) => post('/api/assistant/confirm', { approved }),
  assistantReset: () => post('/api/assistant/reset', {})
};
