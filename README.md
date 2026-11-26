# MedFind — Medicine Availability Finder

MedFind helps customers discover nearby participating pharmacies that report medicine availability. It is a discovery and reservation request platform, not an online pharmacy: it does not sell, dispense, prescribe, recommend substitutions or arrange delivery. Customers should confirm availability directly with the pharmacy before travelling.

## What is implemented

- React, TypeScript and Vite customer application with medicine search, freshness labels, geolocation search, OpenStreetMap map, account pages, reservation history and public About/Contact/Privacy/Terms pages.
- Account profile settings, private saved search locations, default search radius/view, recent searches and search-history deletion/opt-out.
- Pharmacy owner/staff workspace with onboarding, private licence-document upload, opening hours, searchable/filterable/paginated inventory, explicit unavailable state, paginated stock movements, reservation handling, CSV/XLSX preview/commit import and inventory export.
- Pharmacy owners can add existing accounts, edit team permissions, and remove or restore access at `/pharmacy/team`. Owner assignments are protected.
- Pharmacist application, private evidence upload and review history; administrator controlled verification requires a current application and evidence.
- Support tickets with requester conversations, support assignment and status controls, resolution history and in-app notifications.
- Pharmacy and administrator reports for inventory, expiry, movements and aggregate request activity, with UTC date filters and limited search-activity metrics.
- Admin overview, pharmacy verification queue, paginated reservation monitor, searchable user-access management, database-backed role-policy editor, medicine/category catalogue editor with reviewed classifications, and a filtered audit viewer with separately authorized event details. Account details link to permitted account activity. Access changes require current revisions and reasons, preserve required tenant roles and revoke affected account sessions.
- Express REST API under `/api/v1`, MongoDB/Mongoose models, JWT access tokens, rotating opaque refresh tokens in HTTP-only cookies, password hashing, validation, scoped pharmacy assignments and centralized authorization.
- Batch inventory with FEFO reservations, transaction-backed temporary holds, state transition checks, expiry and low-stock sweeps, in-app notifications and Socket.IO user rooms.
- Public medicine-details pages link to exact-ID availability search; catalogue identity is protected once stock or reservation history references it.
- OpenAPI JSON is served at `/api/v1/openapi.json`.

See [DEVELOPMENT_PROGRESS.md](DEVELOPMENT_PROGRESS.md) for the implementation boundary and remaining work. Delivery, privacy, operations, report and administrative workflows are present in source; production configuration and manual verification remain outstanding.

## Architecture

The repository is an npm workspace with a React client and modular Express API. The API owns authentication, authorization, tenant scoping, inventory quantities and reservation transitions. MongoDB transactions are used for stock holds and releases; MongoDB must run as a replica set (including a single-node local replica set). Geospatial pharmacy search uses a `2dsphere` index. See [docs/architecture.md](docs/architecture.md), [docs/database-design.md](docs/database-design.md) and [docs/business-workflows.md](docs/business-workflows.md).

## Prerequisites

- Node.js 20 or later and npm with workspace support.
- MongoDB 7 or later configured as a replica set for reservation and inventory transactions.
- A browser with JavaScript enabled. Location access is optional; the map uses OpenStreetMap tiles.

## Manual setup

1. Copy `server/.env.example` to `server/.env` and `client/.env.example` to `client/.env`. Set distinct random secrets of at least 32 characters for both JWT secrets. Keep `.env` files private.
2. Set `MONGODB_URI` to the replica-set connection string. A local one-node replica set can use `mongodb://127.0.0.1:27017/medfind?replicaSet=rs0` after the developer initializes MongoDB replication.
3. In the repository root, install workspace dependencies with `npm install`.
4. In one terminal, start the API with `npm run dev:server`. In another, start the client with `npm run dev:client`.
5. To create the first administrator, set `BOOTSTRAP_ADMIN_EMAIL` and a unique `BOOTSTRAP_ADMIN_PASSWORD` (minimum 20 characters) in the server environment, then run `npm --workspace server run bootstrap-admin`. Remove those bootstrap values after the command. The command never creates public default credentials or promotes an existing ordinary account.
6. Optional local demo data: set a unique `DEMO_PASSWORD` (minimum 12 characters), then run `npm --workspace server run seed`. Demo pharmacy discovery is disabled by default. Set `ALLOW_DEMO_DISCOVERY=true` only for local demonstration; the UI marks those results as demo data, hides phone contact and disables reservations. Remove seeded records with `npm --workspace server run seed -- --remove-demo`.

The user explicitly reserved dependency installation, environment setup, server execution, builds and testing for their own manual work. None of those commands were run during this implementation.

## API and roles

API route groups include `/auth` (including the current profile at `/auth/me`), `/pharmacies`, `/pharmacies/:id/staff`, `/medicines`, `/search`, `/inventory`, `/reservations`, `/saved-pharmacies`, `/notifications`, `/pharmacists`, `/admin`, `/reports` and `/support`. The route inventory, request examples and response conventions are in [docs/api-documentation.md](docs/api-documentation.md). Backend permissions and tenant boundaries are in [docs/rbac-matrix.md](docs/rbac-matrix.md).

## Environment

All server variables are described in [docs/environment-setup.md](docs/environment-setup.md). Client variables are `VITE_API_URL` and `VITE_MAP_TILE_URL`. No real credentials are included. Local private uploads are written under `server/uploads/private` (or the configured upload directory) and are not served as static files.

## Privacy and regulatory boundary

MedFind does not accept prescription uploads. Pharmacy licence and pharmacist registration evidence are stored outside public static routes. Licence documents require administrator authorization; pharmacist evidence is available to the applicant and authorized reviewers. Search activity is associated with an account only when authenticated. Availability freshness is informational; a pharmacy remains responsible for confirmation, prescription review and dispensing decisions. Privacy and terms pages are starter product copy and require review before launch.

## Operations

Jobs use MongoDB leases with local timers, or BullMQ when Redis is configured. Account email delivery is queued and receipt state is monitored through Resend; optional Twilio Verify confirms saved phone numbers. Private files can use local storage or a private S3-compatible bucket. See [operations and delivery](docs/operations-and-delivery.md) for required configuration, indexes, retention and manual launch checks.

## Remaining before launch

- Set up secrets and services, provision indexes/migrations and review legacy-file migration.
- Complete the manual verification checklist on the developer's replica-set database and assess load against expected data volume.
- Fuzzy search uses a bounded MongoDB scan instead of a dedicated search index. Export and aggregation limits require production capacity review.
- User erasure intentionally blocks accounts with professional/ownership records pending closure; audit evidence, operational identifiers, backups and external provider data have retention outside the erasure transaction.
- The client uses local React primitives and direct API forms in several flows; shadcn/ui and React Hook Form/Zod are not applied everywhere.

See [operations and delivery](docs/operations-and-delivery.md) and [manual testing guide](docs/manual-testing-guide.md). No builds, tests, installs, server starts, external provider calls, migrations or deployments were performed.
