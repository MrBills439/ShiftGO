/**
 * POST /internal/jobs/:name — run one tick of a background job now.
 *
 * For hosts where the API only gets CPU while answering a request (Google
 * Cloud Run): an outside scheduler calls this every minute instead of relying
 * on the in-process cron (set RUN_SCHEDULER=false there). The tick runs inside
 * the request, under the same cluster-wide lock as the cron, so it never runs
 * twice at once.
 *
 * Protected by the X-Jobs-Secret header (JOBS_SECRET, 32+ characters). With no
 * JOBS_SECRET configured the route does not exist (404).
 */
const crypto = require('crypto');
const router = require('express').Router();
const { JOBS } = require('../jobs/scheduler');
const { withJobLock } = require('../jobs/jobLock');
const { captureError } = require('../lib/monitoring');

function secretOk(sent) {
  const expected = process.env.JOBS_SECRET || '';
  if (expected.length < 32 || typeof sent !== 'string' || !sent) return false;
  const a = crypto.createHash('sha256').update(sent).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

router.post('/:name', async (req, res) => {
  if (!secretOk(req.get('x-jobs-secret'))) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });
  const job = Object.prototype.hasOwnProperty.call(JOBS, req.params.name) ? JOBS[req.params.name] : null;
  if (!job) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });
  try {
    const { ran } = await withJobLock(req.params.name, job.run, job.opts);
    res.json({ success: true, data: { job: req.params.name, ran } });
  } catch (err) {
    console.error(`[internal-jobs] ${req.params.name} error`, err.message);
    captureError(err, { job: req.params.name, source: 'internal-jobs' });
    res.status(500).json({ success: false, error: { code: 'JOB_FAILED' } });
  }
});

module.exports = router;
