# Database design

All Mongoose records use timestamps unless noted. ObjectId references are used for tenant and user relationships. Schema creation is in `server/src/modules/models.ts`.

| Collection/model | Purpose and key fields | Important indexes |
|---|---|---|
| User | Account identity, password hash, roles, active state, one refresh-token hash, reset/verification hashes, saved locations, search preferences, settings/access revisions and history serialization counter, demo marker | sparse unique email/phone |
| Role | Built-in role code/name, current permission codes, policy revision and updating administrator | unique code |
| Permission | Implemented permission code and allowed built-in roles | unique code |
| Pharmacy | Owner, address/PIN/city/state, GeoJSON location, hours, licence metadata/private path, approval state/history, active/demo | `2dsphere` location, PIN, status |
| PharmacyStaff | User-to-pharmacy assignment, one pharmacy role, explicit staff permissions and active state | unique `{ pharmacyId, userId }` |
| Pharmacist | User, registration number/council, admin verification state, assigned pharmacies | unique user |
| Medicine | Brand/generic/composition, strength/form, manufacturer, pack size, aliases, verified classification, active/demo | compound text index |
| MedicineCategory | Display name, normalized unique name, description, active/archive state, revision and updating administrator | unique normalizedName; active/name |
| Inventory | One pharmacy/medicine availability summary, update/verification times, stock state, minimum and last editor | unique `{ pharmacyId, medicineId }` |
| InventoryBatch | Batch number, expiry, on hand, reserved, selling price, MRP and active state | inventory/expiry, expiry |
| StockMovement | Pharmacy/inventory/batch, signed quantity, actor, movement type/reference/note | pharmacy/date |
| Reservation | Customer, pharmacy, medicine, quantity, allocated batch quantities, status, hold/pickup deadline, transition history and idempotency key | customer/idempotency, status/deadline, pharmacy/date, medicine/date, date |
| Notification | User, event, content, metadata, dedup key/read state/demo marker | user, unique sparse dedup key |
| SupportTicket | Requester, optional pharmacy, subject/category/priority/status, assignee, revision, comments and resolution/status history | requester/update, status/update, assignee/status/update |
| AuditLog | Actor, action, resource, optional pharmacy, metadata and IP | date, pharmacy/date |
| SearchHistory | Account user, query, optional medicine; one-year TTL; own-history deletion and recording opt-out | TTL on createdAt, user/date |
| SavedPharmacy | Customer-to-approved-pharmacy favorites | unique `{ userId, pharmacyId }` |
| SystemSetting | Typed global values for freshness and reservation windows | unique key |
| InventoryImportJob | One-hour CSV/XLSX preview with valid rows and row errors; explicit committed state | pharmacy/status, TTL expiresAt |

Roles, permissions and medicine categories have dedicated collections. The seven built-in role identities and permission scope ceilings are source defined; administrators configure each role's permission subset in MongoDB. Medicine aliases remain embedded in each exact product, and reservation allocations remain embedded with their parent reservation.

Medicine records also store `categoryIds`, `revision`, `identityLocked`, `updatedBy`, `classificationVerified`, `classificationSource`, `classificationReviewedAt` and `classificationReviewedBy`. Existing absent revisions count as zero. Legacy classification values without complete review metadata are publicly UNVERIFIED. Category arrays are normalized to empty arrays in admin read responses for legacy records.

Catalogue edits use transactions with audit and revision checks. Existing inventory/reservation references lock the identity fields; stock creation and import confirmation also write `identityLocked` in their transaction and require the selected/previewed catalogue revision. This prevents a concurrent first stock addition and identity change from silently relabelling the stock. Existing imports created before revision tracking use revision zero and must be re-previewed if the medicine has changed. Category references are retained when archived, and existing inactive-category links can be preserved on later edits.

Production startup checks the unique, non-sparse, non-partial `MedicineCategory.normalizedName` index before accepting requests. Also provision the new medicine active/name/ID and category/active indexes for catalogue browsing using the deployment migration process. No database migration or index creation was executed during development.

## Quantity invariants

AuditLog browsing adds descending `{ createdAt, _id }` and compound actor/date/ID, action/date/ID, resource-type/resource-ID/date/ID, pharmacy/date/ID and resource-ID/date/ID indexes. Provision these through the production migration process and review overlapping older date/pharmacy indexes before removing any. No index creation was executed. Filter-option aggregation still requires capacity planning for large audit histories; there is no retention/deletion job. Audit APIs append/read records without mutation endpoints, but database operators can still alter records: no cryptographic chain or tamper-proof storage is implemented. Cursor cutoffs are not historical database snapshots.

`available = max(0, onHandQuantity - reservedQuantity)` summed only over active batches with `expiryDate > now`. No batch update may reduce on-hand below reserved. Reservation allocation visits unexpired batches in FEFO order and conditionally increments reserved quantity. Cancellation/rejection/expiry releases reserved quantity; collection decrements both reserved and on-hand. Every such operation writes a stock movement in the same MongoDB transaction.

## Transaction deployment note

Reservation create/update and inventory write paths use MongoDB sessions and transactions. Local MongoDB must be configured as a replica set (a one-node replica set is sufficient for development). Standalone MongoDB will reject these operations. This is documented as an environment requirement rather than silently falling back to unsafe multi-document writes.

Role-policy and account-access changes use transactions and serialize through `SystemSetting` key `rbacAdministration`. This record is an internal sequence, not a configurable product setting. Every access mutation rechecks the actor after acquiring it; account updates also increment `accessRevision` and `authVersion`. Tenant role additions increment `accessRevision`, so an administrator cannot overwrite a concurrently added pharmacy role using an old directory entry. Pharmacy creation commits its owner role, staff assignment and audit alongside the pharmacy.

API startup idempotently initializes the permission catalogue and missing role policies; existing policy selections and revisions are preserved. Non-super authenticated requests fail closed for missing policies. There is no process-local permission cache. Production startup requires non-sparse, non-partial unique indexes on Role.code, Permission.code and SystemSetting.key before catalogue initialization. Provision them using the deployment procedure before starting any API instances. No database or index changes were executed during development.

## Reservation idempotency index migration

New databases use `unique_customer_idempotency_key`, a partial unique index on customer and idempotency key for string keys. The earlier source defined a sparse compound index with the default name `customerId_1_idempotencyKey_1`; because every reservation has a customer ID, that old index can incorrectly constrain requests without a key. Before upgrading an existing database, have a database administrator back up the data, inspect existing indexes and duplicates, remove the obsolete sparse index if present, and create the new partial unique index. Production has automatic index creation disabled, so indexes must be provisioned explicitly. No database migration was executed during development.

Pharmacist profiles store registration details, assignment references, a review revision, status/history and private evidence metadata. The evidence path is excluded from normal queries and points to local private storage. The file is not embedded in MongoDB; backups and orphan-file recovery therefore require separate operational handling.

**Existing pharmacist profiles:** Profiles marked VERIFIED by the earlier implementation may lack evidence. They remain visible, but professional permissions now require evidence metadata and a private evidence path as well as verified status and an active assignment. Ask affected pharmacists to submit updated details and evidence for fresh administrative review. Back up and review existing records before any manual data migration; no database migration was run.

Reporting adds creation-date indexes for users, pharmacies and reservations, plus reservation pharmacy/date and medicine/date indexes. Production disables automatic index creation; administrators must provision and review indexes using their normal migration process. Reporting aggregation requires capacity planning, particularly for large date ranges and fuzzy catalogue filters.

User settings embed up to ten saved locations with subdocument IDs, optional PIN and GeoJSON point, and at most one default. PIN-only entries have no point. Preferences store search radius, list/map view and search-history recording preference. Existing users without settings revision are treated as revision zero; preference defaults are 10 km, list view and enabled account search history. Settings writes replace the location list and increment `settingsRevision` atomically. Search recording writes `searchHistoryRevision` in the same transaction as the history insert, serializing recording with privacy changes and deletion. These counters contain no search contents. Profile changes through `/auth/me` also increment settings revision. Settings audit records contain location count and history preference, without coordinates, labels or medicine names. Add the new SearchHistory `{ userId: 1, createdAt: -1 }` index during the production index migration.
