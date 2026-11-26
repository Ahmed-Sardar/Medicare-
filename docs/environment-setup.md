# Environment setup

## Authorization catalogue and production indexes

API startup creates missing built-in Role policies, the implemented Permission catalogue and the internal access-administration sequence record. Existing policy selections are preserved. Local development can use Mongoose automatic index creation. Production disables automatic indexes and checks the authorization uniqueness indexes before initializing the catalogue or accepting requests.

Before the first production API start, have the database operator review existing records and duplicates, back up the database and provision these indexes in the intended MedFind database using their normal migration process:

```javascript
db.roles.createIndex({ code: 1 }, { unique: true });
db.permissions.createIndex({ code: 1 }, { unique: true });
db.systemsettings.createIndex({ key: 1 }, { unique: true });
db.medicinecategories.createIndex({ normalizedName: 1 }, { unique: true });
```

These commands are handover instructions and have not been executed. Do not remove existing indexes without reviewing their purpose. The application expects non-sparse, non-partial uniqueness on these fields and fails startup if it is missing. Continue provisioning the reservation, tenant, reporting and other indexes documented in database design. MongoDB must support transactions through a replica set.

The catalogue screen is `/admin/catalogue`. Existing medicines do not require a destructive migration: missing revisions start at zero, category lists start empty, and stock/history references are detected when deciding whether identity can be edited. Review legacy classification records through the catalogue editor before claiming a verified classification; the server does not infer verification from the old `prescriptionClass` value. Source references are public after verification. Do not batch-mark legacy records verified without an actual review.

Bootstrap the initial super administrator using the documented explicit bootstrap command, then register and verify another active account before appointing it as an administrator at `/admin/users`. `/admin/access` manages permission policies. No public or default administrator credentials are created. An administrator cannot change their own access; appoint another trusted verified administrator when shared operational access is required.

Copy the examples to local `.env` files manually. The repository does not contain actual credentials.

## Server

| Variable | Required | Purpose |
|---|---:|---|
| `NODE_ENV` | no | development/test/production; default development |
| `PORT` | no | HTTP port, default 4000 |
| `MONGODB_URI` | yes | MongoDB URI. Replica set required for transactions |
| `JWT_ACCESS_SECRET` | yes | Random access-token key, at least 32 characters |
| `JWT_REFRESH_SECRET` | yes | Separate random refresh secret, currently reserved for future JWT refresh use; refresh tokens themselves are opaque random values hashed in the database |
| `ACCESS_TOKEN_TTL` | no | Access JWT lifetime, default 15m |
| `REFRESH_TOKEN_DAYS` | no | Refresh cookie lifetime, default 30 days |
| `CLIENT_URL` | no | Client origin used by integrations |
| `CORS_ORIGINS` | no | Comma-separated exact browser origins |
| `UPLOAD_DIR` | no | Private upload root, default `./uploads` |
| `MAX_UPLOAD_MB` | no | Maximum private document upload size, default 10 MB |
| `INVENTORY_RECENT_MINUTES` | no | Confirmed availability threshold, default 15 |
| `INVENTORY_CONFIRM_MINUTES` | no | Needs-confirmation label upper bound, default 60 |
| `INVENTORY_STALE_MINUTES` | no | Stale warning upper bound, default 240 |
| `RESERVATION_HOLD_MINUTES` | no | Pending temporary allocation duration, default 30 |
| `PICKUP_DEADLINE_HOURS` | no | Pickup deadline after pharmacy confirmation, default 24 |
| `BOOTSTRAP_ADMIN_EMAIL` | setup only | Explicit initial administrator email |
| `BOOTSTRAP_ADMIN_PASSWORD` | setup only | Unique initial password, minimum 20 characters; remove after bootstrap |
| `REDIS_URL` | no | `redis://` or `rediss://`; enables BullMQ scheduling. Without it, Mongo-leased local timers run in each API process |
| `EMAIL_PROVIDER` | production | `console` for local development or `resend` for provider delivery; production requires `resend` |
| `EMAIL_API_KEY` | when using Resend | API key with permission to send email |
| `EMAIL_FROM` | when using Resend | Sender email address on a verified domain |
| `DELIVERY_ENCRYPTION_KEY` | production | Separate 32-byte hexadecimal key for queued email payload encryption; required in production |
| `SMS_PROVIDER` | no | `console` by default or `twilio` to enable Twilio Verify for saved-phone confirmation |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID` | when using Twilio | Twilio Verify account/service credentials; `SMS_API_KEY` is retained for legacy compatibility and is unused |
| `STORAGE_PROVIDER` | no | `local` (default), `private` (local alias), or `s3` |
| `S3_BUCKET`, `S3_REGION` | when using S3 | Private bucket and region; credentials use the AWS SDK default credential chain |
| `S3_ENDPOINT`, `S3_PREFIX` | optional for S3 | Private compatible endpoint and generated object key prefix |
| `RETENTION_NOTIFICATION_DAYS`, `RETENTION_SUPPORT_DAYS` | no | 0 disables automatic purge; permitted range 0–3650 days |
| `ALLOW_DEMO_DISCOVERY` | no | Default false; local demo results only when true, always UI-labeled and non-reservable |
| `DEMO_PASSWORD` | seed only | Unique local demo login password, minimum 12 characters |
| `DEMO_BASE_LAT`, `DEMO_BASE_LNG` | no | Hyderabad demo coordinate anchor; sample pharmacies are offset from this point |

## Client

| Variable | Purpose |
|---|---|
| `VITE_API_URL` | API base, default `http://localhost:4000/api/v1` |
| `VITE_MAP_TILE_URL` | OpenStreetMap-compatible tile URL template |

Never commit `.env` files. In production, use a secret manager, secure cookies over HTTPS, exact CORS origins, private object storage with authenticated access, and an external email/SMS provider.

## Email delivery setup

The developer must set `EMAIL_PROVIDER=resend`, `EMAIL_API_KEY`, `EMAIL_FROM`, and `DELIVERY_ENCRYPTION_KEY` for production. Set `CLIENT_URL` to the browser-facing origin used in account links. Confirm the sender/domain with [Resend](https://resend.com/docs/api-reference/emails/send-email). The app rejects production startup without the required email and encryption configuration. The development console does not send email; development API responses may provide one-time tokens for local account flows. Do not expose development mode publicly. Email records are durably queued encrypted in MongoDB, retried with bounded backoff and polled for provider receipt state. Configure optional Twilio, Redis, storage and retention settings according to [operations and delivery](operations-and-delivery.md).
