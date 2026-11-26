# MedFind development progress

## Completed in source

- Empty workspace inspection; no existing project files were overwritten. Monorepo manifests, TypeScript/Vite config, environment examples and ignore rules added.
- Express API foundation, MongoDB connection, strict environment parsing, structured logging, Helmet/CORS, authentication rate limits, standard errors and `/health`.
- User/password authentication, short-lived access JWTs, atomically rotating HTTP-only refresh cookie, session-version revocation, atomic one-time reset and verification tokens, resend verification, normalized profile responses and Resend account email delivery. Local token return is limited to development.
- Mongoose models for users, pharmacy profiles/assignments, pharmacists, medicines, inventory, batches, movements, reservations, notifications, support tickets, audit logs and search history, with geospatial/text/tenant indexes.
- Database-backed built-in role policies, permission catalogue, central enforcement and pharmacy action authorization; authenticated user/role resolution, per-pharmacy staff assignment checks and customer reservation ownership checks.
- Pharmacy onboarding, private local licence upload, admin-only document download, review status workflow and audit history.
- Medicine catalogue list/detail and administration screens, category management, aliases, reviewed classification metadata, revision/audit controls, protected referenced product identities and exact-ID details/search integration.
- Nearby medicine search with partial multi-field matching, bounded spelling suggestions, exact catalogue selection, price comparison limited to a single medicine, paginated/filterable results, listed opening hours, geospatial radius, optional geolocation, manual PIN, OSM map and demo-data filter.
- Batch inventory addition/correction and details editing, per-item low-stock thresholds, explicit availability state, CSV preview/row errors/confirmation, inventory views and movement history; FEFO stock allocation and transaction-backed reservation holds/release/collection.
- Reservation state transitions, role checks, partial idempotency index, immediate batch/deadline guards for confirmation and collection, pickup deadlines, expiry worker that revisits inactive expired batches, low-stock and expiry notifications; in-app notification APIs and Socket.IO user rooms receiving notification inserts through MongoDB change streams.
- Pharmacy and administrator report screens and scoped APIs for stock, expiry, movements, reservation completion, aggregated demand and authenticated search activity; CSV export guards and audit.
- Support ticket conversations, assignment, status and resolution history, revision checks, audit and notification links with requester and support inbox screens, pharmacist application, private evidence, revision-checked review and history API/UI, admin KPI/pharmacy/user/catalogue/audit/settings APIs, pharmacy hours/contact editor, saved pharmacies, pharmacy inventory CSV and XLSX export.
- React customer home/search/auth/profile/reservation pages, pharmacy dashboard/onboarding, pharmacist workspace, admin overview/review screens, support, notifications and legal starter pages.
- Owner team management page with account lookup, granular access editing, removal and restoration, protected owner assignments, transactional audit/notifications and pharmacist link synchronization. The pharmacy dashboard uses assignment capabilities; administrative pharmacist verification is restricted to admin roles.
- Secure explicit super-admin bootstrap and separately tagged local demo seed/removal scripts.
- Current-turn completion: durable encrypted email queue with retries/receipt polling, optional Twilio Verify for saved-number confirmation, private local/S3 storage and orphan recovery, Redis/BullMQ or MongoDB-leased jobs, shared database rate limiting, notification stream/socket recovery, support fan-out and privacy retention/erasure routes are implemented. Shared validators are wired into request handling, pharmacy inventory search/status/freshness/sort filters are database-side, and platform reservations have an administrator monitor. Public Contact is linked. Report exports and admin pharmacy selection are connected. Operations, API, environment and manual handover docs were reconciled with these behaviors.
- README and architecture, database, API, RBAC, workflow, environment and manual handover documentation.

## Remaining before production use

The planned product workflows in the original brief are implemented in source, including the administrative, customer, pharmacy, pharmacist, reporting, privacy and operations screens. “Implemented” here means source and documentation are present; this workspace has not been built or executed under the project restrictions.

- Provision MongoDB replica-set production, Redis if using BullMQ, private object storage if selected, verified Resend sender, optional Twilio Verify, encryption key, retention policies and required indexes. Follow [operations and delivery](docs/operations-and-delivery.md); no credentials or environment files were changed here.
- Review and provision indexes for new operational collections in existing databases. Startup validates critical TTL/unique indexes, but does not run a migration or backfill. Review old pharmacist evidence and any local-file-to-object-store migration manually.
- Complete the manual verification scenarios in [manual testing guide](docs/manual-testing-guide.md) after installing dependencies in the developer environment. Builds, tests, migrations, server starts, provider calls and deployment were not run.
- `server/.env.example` remains the baseline template and does not yet list every optional/new production variable (delivery encryption, Twilio Verify, S3 and retention). Their names and setup are documented in [environment setup](docs/environment-setup.md). The environment example was left untouched under the no-environment-file-change constraint.
- Some legacy client screens still call Axios directly instead of going through feature service modules; the shared React primitives are used, while shadcn/ui and React Hook Form/Zod are not applied across all forms. These are maintainability/stack-consistency gaps even though server validation and the workflows are implemented.
- Privacy/terms pages contain starter copy and need legal review. OpenAPI now lists actual route methods; request/response field schemas are not yet complete for every operation.
- Remaining source-level risks: account erasure intentionally refuses active professional/ownership records until those records are closed under a separate retention process; audit logs, operational identifiers and external backups/provider records are retained. Fuzzy fallback scans the catalogue with a bounded database query rather than a dedicated search index. Aggregation/export capacity and MongoDB replica-set behavior need measurement against production-sized data. Report pharmacy selection is searchable and paged; ticket retention holds can be managed from the support inbox by super administrators. These workflows still need end-to-end manual review.
- No claim is made that the implementation is production-ready until configuration, index provisioning, migration review, manual verification and operational load review are complete.

## Important architecture decisions

- One modular monolith, API base `/api/v1`.
- MongoDB transactions are required for inventory allocation/release and therefore require a replica set.
- Inventory quantities belong to dated batches. Search excludes expired/disabled batches and requires a manual inventory update within the configured recent threshold before it calls quantity confirmed.
- Only approved active pharmacies appear publicly. Demo pharmacy records require `ALLOW_DEMO_DISCOVERY=true` and are prominently marked, have no public phone, and reject reservations.
- Pharmacy files are stored privately and served only through an authenticated admin route.
- Role claims in JWTs are not trusted for authorization; middleware reads current roles from the database.
- No dependency install, build, test, server start, deployment or `.env` modification was performed.

## Handover

1. Follow [docs/operations-and-delivery.md](docs/operations-and-delivery.md) to provision services, indexes, secrets, storage and retention settings.
2. Review existing-database migration and private-file migration requirements in [docs/database-design.md](docs/database-design.md) and the operations guide.
3. Install dependencies and execute the unrun scenarios in [docs/manual-testing-guide.md](docs/manual-testing-guide.md) in the developer environment using a replica-set MongoDB.
4. Perform production-scale query, export, retry and multi-instance observation before launch.

## Spreadsheet import and export update

- CSV and XLSX inventory imports share the preview and explicit confirmation workflow. XLSX files are constrained to a single visible sheet, 5,000 data rows, and bounded archive expansion; formulas and links are rejected. Valid rows are claimed and committed in a transaction with audit and stock movements.
- Inventory exports support CSV and XLSX, with a 25,000 batch limit. XLSX and CSV templates are available in the pharmacy workspace. The `exceljs` and `yauzl` dependencies are declared but have not been installed.
- Source changes remain unbuilt and untested under the project execution restrictions; XLSX interoperability and concurrent transaction behavior require verification during handover.

## Customer settings and search history update

- Added `server/src/modules/users/router.ts` and `openapi.ts`, `server/src/services/searchHistory.ts`, `client/src/services/customerSettings.ts` and `client/src/modules/CustomerSettings.tsx`. Existing application routes, navigation, search, user schema, auth profile writes, logging, styles and handover documentation were updated.
- `/profile` edits the account name and phone, manages up to ten private saved PIN/coordinate locations and a default location, and saves search radius, list/map view and account-history preference. Unknown fields and foreign location IDs are rejected. Revision checks prevent stale writes; mutations and audit commit together.
- Search loads account defaults before issuing its initial availability request, offers saved-location selection, keeps browser geolocation optional, and ignores a pending browser location result after a newer location choice. The dashboard shows recent searches and offers confirmed deletion. Opt-out deletes existing history and stops recording, with concurrent recording serialized through an account write.
- HTTP request logs exclude query strings, response cookie headers are redacted, and settings/history reads use no-store. Settings audit metadata excludes location details and medicine names. Added a user/date index for account history; production index provisioning remains manual.
- No new dependencies were introduced for this update. No installation, application execution, build, tests, server start, deployment or environment-file modification was performed. The manual guide documents the unexecuted settings/privacy/concurrency scenarios.

## Role policies and user-access administration update

- Added Role/Permission models, `services/rbacCatalog.ts`, `services/rbac.ts`, `services/pharmacyAuthorization.ts`, `services/accessAdministration.ts`, `modules/roles/router.ts` and `openapi.ts`, plus the client access-administration service and screens.
- API startup initializes implemented permission metadata, missing built-in role policies and a serialized administration control record. It preserves existing role policies. Production startup requires unique role-code, permission-code and system-setting-key indexes. Requests resolve effective permissions without a process cache; unsupported permission grants fail closed against source-defined scope ceilings.
- `/admin/access` edits role permission subsets with revision checks and an audit reason. SUPER_ADMIN is immutable. Tenant assignments, assignment permission subsets and pharmacist evidence/verification still constrain professional and pharmacy actions. Inventory, reports, reservations, support-agent discovery and pharmacy capability responses use the shared checks.
- `/admin/users` supports directory search/pagination, account role editing and activation changes. Changes require a current access revision and reason, reject self changes, preserve required pharmacy roles, prevent demo administrator appointments, require verified email for new administrator appointments, and serialize changes to protect active super-administrator access. Only a super administrator can manage administrator accounts. Changed accounts lose access/refresh/reset sessions; local sockets are disconnected.
- Pharmacy creation commits the pharmacy, owner assignment, owner account role and audit in one transaction. Team role additions increment access revisions so stale administrator forms cannot overwrite them.
- Client navigation uses returned effective permissions; account data refreshes on window focus. Existing admin activation controls were replaced with the reason/revision workflow. OpenAPI and manual setup/verification documents describe the new contracts and unexecuted concurrency cases.
- No dependencies were installed or added, no builds/tests or servers were run, no deployment occurred and no environment files were modified. Source changes require the developer's prescribed manual verification before production use.

## Catalogue, categories and medicine-details update

- Added a MedicineCategory collection with normalized unique names, descriptions, archive state and revisions. Medicine records now include category references, editor revisions, an identity lock and classification review/source/actor/date metadata. Startup checks the production category uniqueness index; provisioning instructions are documented and unexecuted.
- Added `modules/medicines/contracts.ts`, `adminRouter.ts`, `publicView.ts` and `openapi.ts`, `services/catalogueIdentity.ts`, and `database/catalogueIndexes.ts`. Replaced the prior unrestricted catalogue write handlers with bounded validation, effective medicine-management permission, transaction/audit and revision checks.
- Added `client/src/services/catalogue.ts`, `CatalogueAdministration.tsx`, `MedicineEditor.tsx`, `CategoryChooser.tsx` and `MedicineDetails.tsx`. `/admin/catalogue` creates/edits medicines and categories, retains drafts across tabs, and supports paginated category selection. `/medicines/:id` shows exact identity and classification context and links to exact-ID availability search. Navigation and search-result links are connected.
- Public catalogue, detail, autocomplete and availability responses show UNVERIFIED unless review metadata is complete. Sources are explicitly public after review; internal reviewer/editor IDs are omitted. Demo classifications cannot be verified. Public medicine reads now consistently respect the demo-discovery setting.
- Stock/import transactions lock the selected medicine identity and check the catalogue revision. Referenced identity fields cannot be edited; category, alias, review and active-state changes remain available. Legacy stock/reservation references also lock identity. Catalogue edits after import preview require a fresh preview. Selected exact-ID links never fall back to another product, and preserve saved PIN/coordinate settings.
- API/OpenAPI, database, setup and manual verification documentation were updated. No dependencies were added/installed, no builds/tests or servers were run, no deployment occurred and no environment files were modified. The source-level integration review does not establish runtime correctness; documented developer verification remains outstanding.

## Audit viewer and account-details update

- Added `server/src/modules/auditLogs/{policy,contracts,router,openapi}.ts`, client audit service and `AuditLogViewer.tsx`. `/admin/audit` supports UTC date, event-group, exact action, actor, pharmacy and resource filters; bounded suggestions; cursor pagination with previous/next; refresh and separately authorized event details.
- Audit reads require base access and explicit event-group grants. Unknown action prefixes are super-only. New ADMIN policies default to pharmacy/catalogue/report groups and projected metadata details; security/support groups require explicit grants, and IP remains super-only. Existing saved policies are preserved: a super administrator must explicitly configure the new group grants. Every endpoint checks current scope; options cannot disclose forbidden action/resource values.
- Summary responses exclude metadata and IP for all roles. Actor names require user-directory access. Event details use group allowlists, nested known-sensitive-key filtering and size/depth bounds; permitted free text is not automatically anonymized. There is no raw-metadata or audit mutation API. List/detail reads are themselves audited and use no-store.
- Signed one-hour cursors bind to user, normalized filters, limit and permitted groups; timestamp/ID ordering retains a fixed time cutoff across pages. Refresh starts a new cutoff. This is not a historical transaction snapshot or tamper-proof audit chain. Added audit browse index declarations; no indexes or database records were provisioned.
- Added `UserDetails.tsx` and `GET /admin/users/:id`, linked from the directory and audit actors. The account view excludes authentication fields, saved locations, searches and support conversations. Paginated pharmacy assignments additionally require pharmacy review/management permission and include revoked assignments. Actor/resource activity links retain independent audit scope checks.
- Updated OpenAPI, API/RBAC/database/manual-verification documentation and README. Source integration was reviewed by reading the changed files. No dependencies were added/installed, no build/test/server commands were run, no deployment occurred, and no environment files were modified. Runtime correctness and all manual verification remain outstanding.
