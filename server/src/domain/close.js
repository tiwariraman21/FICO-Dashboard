// The month-end close checklist, with where each task actually stands.
//
// Three things move a task beyond what the checklist file says:
//  - an update made from the dashboard (marked done, or blocked with a reason)
//  - your approval of the parked entry a task was waiting on, which frees it to go ahead
//  - the calendar: a task past its working day that is not done is late

export function assessClose({ tasks, updates, approvals, today }) {
  const approvalById = new Map(approvals.map((a) => [a.id, a]));

  return tasks.map((t) => {
    const mine = updates.filter((u) => u.taskId === t.id);
    const latest = mine[mine.length - 1] || null;

    let status = t.status;
    let note = t.note;
    let waitingOn = (t.waitingOn || []).map((id) => {
      const a = approvalById.get(id);
      return { id, title: a?.title || id, status: a?.status || 'unknown', withYou: a?.status === 'with-you' };
    });

    if (status === 'waiting' || status === 'not started') {
      const outstanding = waitingOn.filter((w) => w.status === 'with-you' || w.status === 'with-cfo');
      if (waitingOn.length && outstanding.length === 0) {
        const allApproved = waitingOn.every((w) => w.status === 'approved');
        status = allApproved ? 'in progress' : 'blocked';
        note = allApproved
          ? `Your approval is in. ${t.owner} can go ahead.`
          : 'An entry it was waiting for was sent back, so it cannot go ahead as planned.';
      } else if (waitingOn.length && outstanding.every((w) => w.status === 'with-cfo')) {
        note = 'Signed by you; still waiting for the CFO.';
      }
    }

    if (latest) {
      status = latest.status;
      note = latest.note || (latest.status === 'done' ? `Marked done by ${latest.updatedBy}.` : note);
    }

    const late = status !== 'done' && t.dueDate < today;
    return {
      ...t,
      status,
      note,
      waitingOn,
      waitingOnYou: waitingOn.some((w) => w.withYou),
      late,
      completedAt: status === 'done' ? (latest?.status === 'done' ? latest.updatedAt : t.completedAt) : null,
      lastUpdate: latest
    };
  });
}

// Today's working day in the close calendar, read off the tasks themselves.
export function currentWorkingDay(tasks, today) {
  const passed = tasks.filter((t) => t.dueDate <= today).map((t) => t.workingDay);
  return passed.length ? Math.max(...passed) : 0;
}
