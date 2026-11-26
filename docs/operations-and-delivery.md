# Operations and delivery handover

This is a source-level deployment checklist. No credentials, external calls, database migrations, dependency installs, app starts, builds or tests were performed as part of this work.

## Required services and secrets

- Use a MongoDB replica set. Transactions protect account delivery intent, inventory/reservations, support fan-out, privacy changes and administrator reviews. Keep clocks synchronized because job leases expire by wall-clock time.
- Production requires Resend (`EMAIL_PROVIDER=resend`, `EMAIL_API_KEY`, verified `EMAIL_FROM`) and a separate random 32-byte hexadecimal `DELIVERY_ENCRYPTION_KEY`. Account verification/reset messages are stored encrypted in MongoDB and retried with bounded backoff. Resend acceptance is not delivery; receipt polling stores provider event state. Delivery payloads are scrubbed on terminal failure or after receipt retention. Keep the encryption key stable and backed up; rotating it before queued payloads are drained makes those payloads unreadable.
- Optional Twilio Verify requires `SMS_PROVIDER=twilio`, account SID, auth token and Verify service SID. It confirms the account's saved phone via explicit SMS/WhatsApp choice; this is not login OTP or identity proof. Console codes are development-only.
- `STORAGE_PROVIDER=local` keeps private files under the configured upload directory. `s3` requires bucket/region and uses the AWS SDK default credential chain, private object keys and server-side AES256 encryption. Block public access and grant the API only the needed operations under its configured prefix. S3 endpoint customizations are for compatible private services. No automatic local-file migration exists; plan a controlled copy/update/verification before switching providers. Bucket versioning and backups need their own retention policy.
- `REDIS_URL` enables BullMQ job scheduling. Without Redis, each API process runs local timers protected by MongoDB leases. Leases reduce duplicate work but are not fencing tokens; keep job writes idempotent/transactional and clocks synchronized. Queue job data contains no provider credentials. MongoDB change streams deliver durable notification records to each instance's local sockets; notification history remains authoritative.

## Indexes and retention

On an existing database, provision new indexes before production startup. Operational startup checks TTL indexes on EmailDelivery, PhoneChallenge, RateBucket and SupportFanout, plus the unique sparse notification deduplication index. Model initialization creates indexes for new collections; it does not migrate or repair legacy indexes. Follow [database design](database-design.md), including the older reservation idempotency migration and report/search indexes.

Retention sweeps are disabled by default (`RETENTION_NOTIFICATION_DAYS=0`, `RETENTION_SUPPORT_DAYS=0`). Set approved day counts from the applicable policy only after review. Support content purge skips held tickets. A separate super-administrator workflow can place and release ticket holds with a reason and revision. Account erasure refuses active pharmacy ownership/staff/pharmacist records, active reservations, unresolved support tickets and held tickets. Erasure removes account contact/authentication data and selected account history, but retains audit evidence, operational identifiers, some transaction history, backups and external provider records. This is not complete anonymization or backup erasure.

## Recovery and monitoring

Import scratch files older than one day and unreferenced private files older than seven days are candidates for cleanup. Local cleanup is per host. S3 cleanup scans only the configured generated-key prefix; review lifecycle/versioned-object behavior separately. Verify mount permissions, disk capacity, backup/restore and object access policy operationally.

The super-administrator Operations screen reports sanitized email delivery state, queue/lease counts, change-stream state, provider selection and retention configuration. It does not expose message bodies, tokens, credentials or a complete distributed tracing system. Alert on delivery failures, stuck leases, stream reconnects, worker lag, storage growth, DB transaction failures and API errors using deployment monitoring.

## Manual verification before launch

After the developer provisions services and installs dependencies, execute [manual testing guide](manual-testing-guide.md). Add deployment checks for: killing a worker during email send and verifying idempotent retry; provider timeout/429/5xx and bounce/complaint receipts; Redis outage/reconnect and two API instances; MongoDB primary change during a transaction; change-stream resume and socket revocation; object access denial and local/S3 orphan recovery; TTL and unique indexes in a restored database; retention hold/release and erasure blockers; and query/export latency at expected production data volume. These scenarios remain unexecuted.
