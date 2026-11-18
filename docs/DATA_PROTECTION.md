# Data protection: what the app does, and what you still need to do

ShiftGO processes staff and resident data for each care agency. **Each agency
is the controller; ShiftGO (you) is its processor.** This page maps UK GDPR
duties to features, and lists what needs people, not code.

## Built into the app

| Duty | Feature | Where |
|---|---|---|
| Tell people how their data is used (Art. 13) | Privacy notice every staff member must acknowledge; re-shown when it changes | Web + mobile on sign-in; HR edits it in Admin → Privacy |
| Right of access (Art. 15) | "Download my data" (JSON); HR export per employee for emailed requests | Web Profile → Your data; Staff → employee → Export data |
| Right to erasure (Art. 17), App Store / Play account deletion | Staff request deletion in the web or mobile app; HR completes or declines | Mobile Profile → Privacy & your data; Admin → Privacy |
| Storage limitation (Art. 5) | Daily retention job: exact GPS cleared after 90 days, right-to-work records deleted 2 years after leaving | `backend/src/jobs/retentionJob.js` (report-only until `RETENTION_ENABLED=true`) |
| Security (Art. 32) | Tenant isolation, role-scoped access, audit log of sensitive views, encrypted document storage option, error reports without personal data | See PRs for weeks 1–2 |
| Accountability (Art. 5(2)) | Audit trail of who viewed/changed DBS, right-to-work, residents, exports and deletions (HR only) | `GET /audit-logs` |

Lawful basis: staff data is processed for the **employment contract**,
**legal obligations** (right to work, working time, payroll) and **legitimate
interests** (attendance, safeguarding). The notice is acknowledged, not
consented to: do not add "I consent" wording.

## Before the first agency goes live (not code)

1. **Data protection impact assessment (DPIA).** Required: the app tracks
   employee location in the background. Record why it is necessary, that it
   runs only while clocked in, the 90-day retention, and the alternatives
   considered.
2. **Register with the ICO** and pay the data protection fee.
3. **Data processing agreements**: one between you and each agency, and
   check you have them with Resend (email), Railway, Google (Firebase), Expo, your
   storage provider and Sentry. Document US transfers (UK IDTA / UK
   Extension to the EU–US Data Privacy Framework).
4. **Privacy notice text.** The built-in template is a draft. Each agency's
   data protection lead should review it, add contact details, and publish
   their version in Admin → Privacy.
5. **Retention schedule.** Agree the periods with each agency, set
   `GPS_RETENTION_DAYS` / `RTW_RETENTION_DAYS`, check the job's report-only
   log, then set `RETENTION_ENABLED=true`.
6. **Breach procedure.** Who decides, how you tell the agency, and the 72-hour
   ICO deadline.
7. **Certifications care buyers ask for:** Cyber Essentials, and the NHS Data
   Security and Protection Toolkit.
8. **App store privacy labels.** Declare precise location, contact info,
   identifiers and diagnostics (if Sentry is on) in App Store Connect and the
   Play Data safety form, and link the privacy policy.

## Responding to requests

- **Access request** (one month): HR → employee page → Export data, send
  the file securely. Add any records held outside ShiftGO.
- **Deletion request** (one month): the person deactivates via offboarding,
  then HR completes the request. The app keeps what the law requires and says
  so in the confirmation.
