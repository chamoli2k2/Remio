import { ContentReport, Folder, User } from '../models/index.js';
import { assert, notFound } from '../utils/errors.js';
import { notifyStaff } from './notificationService.js';
import { logger } from '../utils/logger.js';

/** What a reporter is shown back, and what the queue lists. Never the reporter's address. */
const present = report => ({
  id: report.id,
  reason: report.reason,
  detail: report.detail,
  status: report.status,
  outcome: report.outcome,
  createdAt: report.createdAt,
  reviewedAt: report.reviewedAt,
  folder: report.folder?.title ? { id: report.folder.id, title: report.folder.title, visibility: report.folder.visibility, owner: report.folder.owner?.username } : { id: String(report.folder) },
  reporter: report.reporter?.username || (report.email ? 'by email' : 'anonymous'),
});

/**
 * Takes a notice about a published collection.
 *
 * Only public folders can be reported, because a private one is not published to the person
 * reporting it and a report would otherwise confirm that a given id exists. A missing or private
 * folder gives the same answer as a real one that cannot be found.
 */
export async function report(folderId, { reason, detail = '', email = '' }, reporter = null) {
  const folder = await Folder.findById(folderId).select('visibility owner title');
  assert(folder && folder.visibility === 'global', 404, 'That collection is not published.', 'NO_FOLDER');
  // Nobody needs to report their own folder; they can edit or unpublish it.
  assert(!reporter || String(folder.owner) !== String(reporter.id), 400, 'This is your own collection. You can unpublish or delete it in its menu.', 'OWN_FOLDER');

  const open = await ContentReport.findOne({ folder: folder.id, status: 'open', ...(reporter ? { reporter: reporter.id } : {}) });
  // A second notice from the same person about the same thing adds nothing to the queue, so it is
  // accepted rather than refused: arguing with somebody trying to report a problem is the wrong
  // response, and they get the same acknowledgement either way.
  if (open && reporter) return { report: present(open), duplicate: true };

  const saved = await ContentReport.create({
    folder: folder.id, reporter: reporter?.id || null, email: email.trim().toLowerCase(),
    reason, detail: detail.trim(),
  });
  // Failing to notify staff must not fail the report: the record is the thing that matters, and
  // the queue is read on its own anyway.
  notifyStaff('content.reported', { actor: reporter, data: { reportId: saved.id, folderId: folder.id, reason } })
    .catch(e => logger.warn('could not notify staff of a content report', { error: e.message }));
  return { report: present(saved), duplicate: false };
}

/** The queue, newest first, open ones by default because those are the ones needing a decision. */
export async function list({ status = 'open', limit = 100 } = {}) {
  const query = status === 'all' ? {} : { status };
  const rows = await ContentReport.find(query)
    .sort({ createdAt: -1 }).limit(Math.min(200, Math.max(1, Number(limit) || 100)))
    .populate('folder', 'title visibility owner').populate('reporter', 'username');
  for (const row of rows) if (row.folder?.owner) row.folder.owner = await User.findById(row.folder.owner).select('username');
  return {
    reports: rows.map(present),
    open: await ContentReport.countDocuments({ status: 'open' }),
  };
}

/**
 * Records a decision, and carries it out when the decision is to uphold the notice.
 *
 * Upholding unpublishes the collection rather than deleting it. The owner keeps their work and can
 * appeal or correct it; deleting somebody's material on a single unreviewed complaint is a far
 * worse error to make than leaving it hidden while it is sorted out.
 */
export async function decide(id, { status, outcome = '' }, reviewer) {
  const report = await ContentReport.findById(id);
  if (!report) throw notFound('Report not found.', 'NO_REPORT');
  assert(['upheld', 'rejected'].includes(status), 400, 'A report is either upheld or rejected.', 'BAD_STATUS');

  if (status === 'upheld') {
    await Folder.updateOne({ _id: report.folder }, { $set: { visibility: 'private' } });
    logger.warn('a reported collection was unpublished', { folderId: String(report.folder), reportId: id, by: reviewer.username });
  }
  report.status = status;
  report.outcome = String(outcome).trim().slice(0, 500);
  report.reviewedBy = reviewer.id;
  report.reviewedAt = new Date();
  await report.save();
  await report.populate([{ path: 'folder', select: 'title visibility owner' }, { path: 'reporter', select: 'username' }]);
  return { report: present(report) };
}
