// The shell: sign-in gate, header, tabs, and which screen is showing.
//
// The whole dashboard is loaded in one call and held here. The company-code selector then
// filters it in the browser, so switching unit redraws every screen at once without a
// round trip. After any action the payload is simply fetched again: the server re-runs
// every rule, so a decision shows up everywhere it matters (the approval list, the close
// tracker, the problems list) without each screen having to know about the others.

import { useState, useEffect, useCallback } from 'react';
import { api, setSignedOutHandler } from './api.js';
import { COMPANY, PRODUCT, USER_PROFILE } from './brand.js';
import { initials, dmy, when, inr } from './format.js';
import { Icon, Loading, ErrorPanel } from './components/ui.jsx';
import { Wordmark, WordmarkFallback, Modal, Toasts } from './components/shell-bits.jsx';
import { waitingForMe, openProblems, byUnit, cashFor, payablesFor, closeFor } from './selectors.js';

import Login from './screens/Login.jsx';
import Overview from './screens/Overview.jsx';
import Approvals from './screens/Approvals.jsx';
import ApprovalDetail from './screens/ApprovalDetail.jsx';
import Receivables from './screens/Receivables.jsx';
import Payables from './screens/Payables.jsx';
import Cash from './screens/Cash.jsx';
import Budgets from './screens/Budgets.jsx';
import Close from './screens/Close.jsx';
import Problems from './screens/Problems.jsx';
import Assistant from './components/Assistant.jsx';

export default function App() {
  const [session, setSession] = useState('checking');
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(null);

  const [tab, setTab] = useState('overview');
  const [openDoc, setOpenDoc] = useState(null); // { kind, id }
  const [focus, setFocus] = useState(null); // a customer or cost centre to open on arrival
  const [unit, setUnit] = useState('all');
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem('fico-theme') || 'light';
    } catch {
      return 'light';
    }
  });

  const [toasts, setToasts] = useState([]);
  const [busy, setBusy] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [showProfile, setShowProfile] = useState(false);
  const [log, setLog] = useState(null);
  const [showAsk, setShowAsk] = useState(false);

  useEffect(() => {
    api.session().then((r) => setSession(r.signedIn ? r : null)).catch(() => setSession(null));
  }, []);

  useEffect(() => {
    setSignedOutHandler(() => {
      setSession(null);
      setData(null);
    });
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem('fico-theme', theme);
    } catch {
      // private window: the choice simply is not remembered
    }
  }, [theme]);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setData(await api.dashboard());
    } catch (error) {
      setLoadError(error.message);
    }
  }, []);

  useEffect(() => {
    if (session && session !== 'checking') load();
  }, [session, load]);

  const dismissToast = useCallback((id) => setToasts((list) => list.filter((t) => t.id !== id)), []);
  function toast(tone, icon, message) {
    setToasts((list) => [...list, { id: Date.now() + Math.random(), tone, icon, message }]);
  }

  // What the mail did, in words, so "saved" is never mistaken for "sent".
  function mailNote(mail) {
    if (!mail) return '';
    if (mail.sent) return mail.delivered === false ? ' Mail sent to the catch-all mailbox.' : ' Mail sent.';
    return ' No mail sent (email is not set up).';
  }

  function navigate(next, target = null) {
    setTab(next);
    setOpenDoc(null);
    setFocus(target);
    setActionError(null);
    window.scrollTo({ top: 0 });
  }

  function openDocument(kind, id) {
    setTab('approvals');
    setOpenDoc({ kind, id });
    setActionError(null);
    window.scrollTo({ top: 0 });
  }

  // Runs one action, refreshes the data, and says what happened.
  async function act(key, work, success) {
    setBusy(key);
    setActionError(null);
    try {
      const result = await work();
      await load();
      const message = typeof success === 'function' ? success(result) : success;
      if (message) toast('pos', 'check', message);
      return result;
    } catch (error) {
      setActionError(error.message);
      toast('neg', 'alert', error.message);
      return null;
    } finally {
      setBusy(null);
    }
  }

  const handlers = {
    decide: (doc, decision, note) =>
      act(
        decision,
        () => (decision === 'approve' ? api.approve(doc.kind, doc.id, note) : api.reject(doc.kind, doc.id, note)),
        (r) =>
          (decision === 'approve'
            ? `${doc.kindLabel} ${doc.id} approved${r.passedTo ? `, passed to ${r.passedTo}` : ''}.`
            : `${doc.kindLabel} ${doc.id} sent back to ${doc.preparedBy.name}.`) + mailNote(r.mail)
      ),
    remindCfo: (doc) => act('remind', () => api.remindCfo(doc.kind, doc.id), (r) => `Reminder recorded for the CFO.${mailNote(r.mail)}`),
    fixProblem: (p, note) => act(`fix:${p.id}`, () => api.fixProblem(p.id, note), (r) => `Handed to ${r.owner}.${mailNote(r.mail)}`),
    setTaskStatus: (t, status, note) => act(`task:${t.id}`, () => api.setTaskStatus(t.id, status, note), `"${t.title}" is now ${status}.`),
    nudgeTask: (t) => act(`nudge:${t.id}`, () => api.nudgeTask(t.id), (r) => `Asked ${t.owner} for an update.${mailNote(r.mail)}`),
    remindCustomer: (c, level) =>
      act(`remind:${c.id}`, () => api.remindCustomer(c.id, level), (r) => `Level ${r.level} reminder to ${c.name} recorded.${mailNote(r.mail)}`),
    recordPromise: (c, amount, date, note) =>
      act(`promise:${c.id}`, () => api.recordPromise(c.id, amount, date, note), `Promise from ${c.name} recorded: ${inr(amount)} by ${dmy(date)}.`)
  };

  async function openLog() {
    setShowProfile(false);
    setLog({ loading: true, entries: [] });
    try {
      const r = await api.actionLog();
      setLog({ loading: false, entries: r.entries });
    } catch (error) {
      setLog({ loading: false, entries: [], error: error.message });
    }
  }

  async function signOut() {
    try {
      await api.logout();
    } finally {
      setSession(null);
      setData(null);
      setShowProfile(false);
    }
  }

  if (session === 'checking') return <div className="loginpage"><Loading what="your session" /></div>;
  if (!session) return <Login onSignedIn={setSession} />;
  if (loadError) {
    return (
      <div className="wrap" style={{ paddingTop: 30 }}>
        <ErrorPanel message={loadError} onRetry={load} />
      </div>
    );
  }
  if (!data) return <div className="wrap"><Loading what="the dashboard" /></div>;

  const me = data.me;
  const doc = openDoc ? data.approvals.find((d) => d.kind === openDoc.kind && d.id === openDoc.id) : null;
  const cash = cashFor(data, unit);
  const pay = payablesFor(data, unit);
  const close = closeFor(data, unit);

  const TABS = [
    { key: 'overview', label: 'Overview', icon: 'chart' },
    { key: 'approvals', label: 'Approvals', icon: 'shield', count: waitingForMe(data.approvals, unit).length },
    { key: 'receivables', label: 'Receivables', icon: 'up', count: byUnit(data.receivables.customers, unit).filter((c) => c.band === 'high').length, tone: 'neg' },
    { key: 'payables', label: 'Payables', icon: 'down', count: pay.msmeBreached.length + pay.blocked.length },
    { key: 'cash', label: 'Cash', icon: 'box', count: cash.short.length, tone: 'neg' },
    { key: 'budgets', label: 'Budgets', icon: 'chart', count: byUnit(data.budgets, unit).filter((b) => b.status === 'over').length },
    { key: 'close', label: `${data.fiscal.closingPeriodLabel.split(' ')[0]} close`, icon: 'clock', count: close.late.length },
    { key: 'problems', label: 'Problems found', icon: 'alert', count: openProblems(data.problems, unit).length }
  ];

  const common = { data, unit, onNavigate: navigate, onOpenDocument: openDocument, busy, handlers, actionError };

  return (
    <>
      <header className="shell">
        <div className="shell-in">
          <button className="brand" onClick={() => navigate('overview')} type="button">
            <Wordmark />
            <WordmarkFallback />
            <span className="bdiv" />
            <span className="bstack">
              <span className="b1">{COMPANY}</span>
              <span className="b2">{PRODUCT}</span>
            </span>
          </button>

          <span className="sp" />

          <span className="asof" title={data.frozen ? 'Sample data is dated to a fixed day so the figures stay the same between demos.' : 'Live data'}>
            <Icon name={data.frozen ? 'eye' : 'clock'} size={12} />
            {data.frozen ? `Sample data as of ${dmy(data.asOf)}` : `Data as of ${dmy(data.asOf)}`}
          </span>

          <select className="sel" value={unit} onChange={(e) => setUnit(e.target.value)} aria-label="Choose company code">
            <option value="all">All company codes</option>
            {data.companyCodes.map((c) => (
              <option key={c.code} value={c.code}>{c.code} {c.name}</option>
            ))}
          </select>

          <button className="hdrbtn" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} title={`Switch to ${theme === 'light' ? 'dark' : 'light'} appearance`} type="button">
            <Icon name={theme === 'light' ? 'moon' : 'sun'} size={16} />
            <span className="hide-sm">{theme === 'light' ? 'Light' : 'Dark'}</span>
          </button>

          <button className="pillbtn" onClick={() => setShowAsk(true)} type="button">
            <Icon name="spark" size={15} />
            Ask
          </button>

          <button className="hdrbtn danger" onClick={signOut} title="End this session" type="button">
            <Icon name="back" size={16} />
            <span className="hide-sm">Sign out</span>
          </button>

          <button
            className={`userbtn${showProfile ? ' open' : ''}`}
            onClick={() => setShowProfile((v) => !v)}
            aria-expanded={showProfile}
            aria-haspopup="menu"
            title={`${me.name}, ${me.title}`}
            type="button"
          >
            <span className="me">{initials(me.name)}</span>
            <span className="uname hide-sm">{me.name}</span>
            <span className="ucaret"><Icon name="chevron" size={14} /></span>
          </button>
        </div>
      </header>

      <nav className="nav">
        <div className="nav-in" role="tablist">
          {TABS.map((t) => (
            <button key={t.key} className="navb" role="tab" aria-selected={tab === t.key} onClick={() => navigate(t.key)} type="button">
              <Icon name={t.icon} size={15} />
              {t.label}
              {t.count > 0 && <span className="cnt n">{t.count}</span>}
            </button>
          ))}
        </div>
      </nav>

      <main className="wrap content">
        {tab === 'overview' && <Overview {...common} onOpenLog={openLog} />}
        {tab === 'approvals' && !doc && <Approvals {...common} />}
        {tab === 'approvals' && doc && (
          <ApprovalDetail {...common} doc={doc} onBack={() => setOpenDoc(null)} />
        )}
        {tab === 'receivables' && <Receivables {...common} focus={focus} />}
        {tab === 'payables' && <Payables {...common} />}
        {tab === 'cash' && <Cash {...common} />}
        {tab === 'budgets' && <Budgets {...common} focus={focus} />}
        {tab === 'close' && <Close {...common} />}
        {tab === 'problems' && <Problems {...common} />}
      </main>

      <Assistant open={showAsk} onClose={() => setShowAsk(false)} filter={{ companyCode: unit, screen: tab }} onActed={load} name={me.name} />

      {showProfile && (
        <>
          <div className="mscrim" style={{ background: 'transparent' }} onClick={() => setShowProfile(false)} />
          <aside className="prof" style={{ top: 62 }} aria-label="Your account">
            <div className="phd">
              <span className="pav">{initials(me.name)}</span>
              <div>
                <div className="pn">{me.name}</div>
                <div className="pr">{me.title}, {USER_PROFILE.dept}</div>
              </div>
            </div>
            <div className="pbd">
              <div className="psec">SIGNED IN AS</div>
              <ProfileRow k="Email" v={data.user.email} />
              <ProfileRow k="SAP user" v={USER_PROFILE.sapUser} />
              <div className="psec">AUTHORITY</div>
              <ProfileRow k="Company codes" v={USER_PROFILE.companyCodes} />
              <ProfileRow k="Your limits" v={`Journal entries up to ${inr(data.limits.journalEntry)}, invoice releases up to ${inr(data.limits.invoiceRelease)}, payment runs up to ${inr(data.limits.paymentRun)}`} />
              <ProfileRow k="Above that" v={`${data.people.cfo.name} signs after you`} />
              <div className="psec">DATA</div>
              <ProfileRow k="Source" v={data.dataSource === 'sample' ? 'Sample data (invented)' : 'SAP S/4HANA'} />
              <ProfileRow k="As of" v={dmy(data.asOf)} />
              <ProfileRow k="Fiscal year" v={`${data.fiscal.year}, closing ${data.fiscal.closingPeriodLabel}`} />
            </div>
            <div className="pset">
              <button className="pitem" type="button" onClick={openLog}>
                <span className="pi"><Icon name="clock" size={14} /></span>
                Everything done from here
              </button>
              <button className="pitem" type="button" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>
                <span className="pi"><Icon name="moon" size={14} /></span>
                Appearance
                <span className="pv">{theme === 'light' ? 'Light' : 'Dark'}</span>
              </button>
              <button className="pitem out" type="button" onClick={signOut}>
                <span className="pi"><Icon name="back" size={14} /></span>
                Sign out
              </button>
            </div>
          </aside>
        </>
      )}

      {log && (
        <Modal
          icon="clock"
          title="Everything done from this dashboard"
          onClose={() => setLog(null)}
          footer={
            <>
              <span style={{ fontSize: '12.9px', color: 'var(--ink-2)' }}>Kept in db/fico.db, newest first</span>
              <span style={{ flex: 1 }} />
              <button className="btn q" type="button" onClick={() => setLog(null)}>Close</button>
            </>
          }
        >
          {log.loading ? (
            <div className="logempty">Loading…</div>
          ) : log.error ? (
            <div className="logempty">{log.error}</div>
          ) : log.entries.length === 0 ? (
            <div className="logempty">Nothing yet. Approve a document, hand a problem to its owner or send a reminder, and it is listed here with who did it and whether the mail went.</div>
          ) : (
            log.entries.map((e, i) => (
              <div className="logrow" key={i}>
                <span className="lt n">{when(e.at)}</span>
                <span className="lw">
                  <b>{e.action}</b>{e.reference ? ` · ${e.reference}` : ''}{e.value ? ` · ${inr(e.value)}` : ''}
                  {e.note ? <><br /><span className="muted">{e.note}</span></> : null}
                  {e.emailStatus ? <><br /><span className="muted">{e.emailStatus}</span></> : null}
                </span>
                <span className="lm" style={{ color: 'var(--ink-3)' }}>{e.doneBy}</span>
              </div>
            ))
          )}
        </Modal>
      )}

      <Toasts items={toasts} onDismiss={dismissToast} />
    </>
  );
}

function ProfileRow({ k, v }) {
  return (
    <div className="prow">
      <span className="k">{k}</span>
      <span>{v}</span>
    </div>
  );
}
