# Architecture

## Components

```text
React/Vite browser client
  ├─ REST JSON and HTTP-only cookie auth ──> Express /api/v1
  ├─ Socket.IO (cookie-authenticated user room)
  └─ OpenStreetMap tiles
                                         ├─ MongoDB (Mongoose)
                                         ├─ private local file directory
                                         └─ in-process operational sweep
```

The server is a modular monolith. Route handlers validate input, load database records, apply authorization and call transaction-backed business operations. `middleware/authorize.ts` enforces effective permissions loaded from MongoDB Role policies on each request. `services/rbacCatalog.ts` defines built-in role identities, default policies and permission scope ceilings; `services/pharmacyAuthorization.ts` combines those permissions with active assignments and professional verification. Client role guards and capability-based navigation are not security boundaries.

## Trust boundaries

- Every authenticated request resolves the user and current roles from MongoDB; client role data and JWT role claims do not authorize actions.
- Pharmacy inventory and reservations are scoped to a pharmacy assignment. Customer reservation reads/updates are scoped to the customer id.
- Discovery filters out inactive/unapproved pharmacies, expired/inactive batches and zero available quantities.
- Confirmed availability requires inventory update age within `INVENTORY_RECENT_MINUTES`. Older positive quantities are returned with freshness status and cannot be reserved through the customer flow.
- Reservation batch allocations use conditional updates and a MongoDB session. A replica-set deployment is required. No payment, delivery, prescription document intake or automatic substitution exists.
- Licence uploads use generated file names under a private folder; there is no public static uploads route. Only pharmacy owners upload their assigned pharmacy document; pharmacy review administrators download it.

## Data access and indexes

Pharmacy coordinates use GeoJSON `[longitude, latitude]` and a `2dsphere` index. Search uses `$near` with a configured maximum radius, then looks up matching active inventory and unexpired batches. Inventory has a unique pharmacy/medicine pair; staff has a unique pharmacy/user pair; reservations have customer/idempotency key uniqueness. Text and compound indexes are defined on the medicine catalogue and common tenant/date paths.

## Runtime and integrations

Jobs use local timers guarded by MongoDB leases, or BullMQ schedules when Redis is configured. MongoDB transactions are required for account delivery intent, inventory/reservations, support fan-out and privacy workflows. Socket.IO instances watch MongoDB notification inserts and emit to their own connected clients; durable notification history is authoritative. Account email delivery is queued encrypted in MongoDB and integrated with Resend retry/receipt state. Optional Twilio Verify confirms saved phone numbers. Private files can use local storage or private S3-compatible storage. See [operations and delivery](operations-and-delivery.md) for credentials, indexes, recovery, retention and manual launch checks. Session version checks revoke HTTP/new socket connections, and connected local sockets are periodically revalidated against MongoDB.

## Error/response format

Success responses use `{ success: true, data: ... }`. Errors use `{ success: false, error: { code, message } }`; validation details are included only outside production. The API does not return stack traces. HTTP request logs redact credentials and do not log request bodies.
