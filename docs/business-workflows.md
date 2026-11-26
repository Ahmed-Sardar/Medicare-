# Business workflows

## Account settings and saved locations

An authenticated user opens Profile and search settings from the header or customer dashboard. They can edit their name and phone, maintain up to ten labelled locations using a PIN code or coordinates, select one default, and choose search radius and list/map view. Changes are saved together; a stale revision is rejected and the user can reload before retrying. Saved locations are private to the account. Opening search applies the saved default and offers an explicit saved-location selector; browser geolocation remains optional and is not automatically persisted. Choosing browser location clears saved PIN filters, and a later saved-location choice supersedes a pending browser location response.

The customer dashboard displays the latest 20 recorded searches with links to repeat a query. Clearing history requires confirmation and allows future searches to be recorded. Turning off account search history in settings confirms deletion of existing history and prevents further recording until re-enabled. Reported search activity can therefore exclude opted-out or deleted activity and must never be described as sales or complete customer demand.

## Pharmacy onboarding and verification

1. A pharmacy owner creates an account and a DRAFT profile with address, PIN, coordinates and licence metadata.
2. The owner uploads a PDF/JPEG/PNG licence document. A generated filename is stored under a private directory and the action is audited.
3. Owner submits the application; submission is rejected until a document exists. Admin moves the application through review and records status/reason history.
4. Only an active APPROVED pharmacy is returned by public discovery. Approval requires a recorded licence number and uploaded document; upload itself does not verify the licence.

## Inventory entry and search

1. An owner or staff member with explicit inventory permission selects a catalogue medicine and enters a batch number, expiry, quantity and selling price/MRP.
2. Each batch persists on-hand and reserved quantities independently. Batch writes and stock movements use a MongoDB transaction.
3. Public search geospatially selects approved pharmacies, matches medicine catalogue fields, excludes expired/inactive batches, and computes available quantity from remaining batch quantities.
4. Freshness is based on `Inventory.lastUpdatedAt`. Only `RECENTLY_UPDATED` results are shown as confirmed and can be reserved. Customers should still call the pharmacy. Demo rows are excluded by default and cannot accept reservations.

## Reservation state and stock

`PENDING → CONFIRMED → READY_FOR_PICKUP → COLLECTED`

Allowed alternate terminal paths include `REJECTED`, `CANCELLED`, and `EXPIRED` where transition rules permit. Customer can cancel their own eligible request. Pharmacy owner/admin or a verified assigned pharmacist reviews and updates pharmacy requests.

On create, FEFO allocation conditionally increments each selected batch's reserved quantity and creates a temporary hold. If any requested quantity cannot be allocated, the MongoDB transaction rolls back. Confirmation establishes a pickup deadline. Reject/cancel/expiry decrements held quantity. Collection decrements both held and on-hand quantity. Movement rows and history updates are part of the operation. Repeating a final-state action must never allocate or decrement twice.

## Scheduled alerts

The scheduled sweep expires temporary holds and overdue pickups, releases stock, sends deduplicated expiry notices, marks expired batches inactive and creates daily low/out-of-stock/freshness notices. Local timers are guarded by MongoDB job leases; Redis configuration selects BullMQ scheduling. Leases prevent routine overlapping runs but are not fencing tokens or an exactly-once guarantee. Jobs must remain idempotent/transactional.

## Support and pharmacist verification

Customers and pharmacy users open tickets with a category, priority and optional pharmacy. Only the requester and support managers can read or reply. Support managers assign active support agents and change status, priority and resolution notes; resolving or closing requires notes. A requester reply reopens a closed or resolved ticket, retaining the old resolution in status history. Transactional audit and generic in-app notifications accompany changes. Agent replies to closed/resolved tickets require reopening first. An actively assigned pharmacist submits registration and council details, then uploads private registration evidence. An administrator who is not the applicant reviews the evidence and records a decision; rejection requires a reason. The applicant can see the status and history. Editing registration details returns the profile to pending and clears previous evidence. Admin review uses a revision check to reject stale decisions, and manual review is not automated council verification. Only VERIFIED profiles linked to an active pharmacy assignment may perform professional review transitions. The pharmacist workspace records a review note and an acknowledgement of stock and applicable prescription checks; it does not accept patient prescriptions or authorize dispensing.

## Reports and privacy

Authorized pharmacy assignments can view current unexpired unreserved physical stock, low-stock thresholds, expiring/expired batches, movements and reservation records without customer identity fields. The report status and date filters apply to request or movement creation; inventory and expiry are snapshots. The collected share is the share of all requests created in the selected period that currently have COLLECTED status. CSV and XLSX exports include up to 25,000 batches and shows zero public availability for disabled or expired stock.

Platform administrators can view registrations, current inventory freshness, request statuses and authenticated search activity. Search text and user identities are not returned. Medicine demand means reservation requests rather than sales; groups below five distinct requesters and search activity below five distinct users are suppressed. These safeguards do not guarantee anonymity against differencing across filters. Demo records are excluded from platform reports.
