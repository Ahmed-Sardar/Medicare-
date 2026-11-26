# Manual verification guide

This is a developer-run checklist. It was not executed during this implementation.

## Source-audit additions (not executed)

- In the pharmacy workspace, search inventory by medicine text, filter stock and each freshness category, switch sort direction, apply filters, page through results and verify counts stay scoped to the selected pharmacy. Confirm clearing filters restores the full authorized inventory.
- In `/admin/reservations`, confirm platform admins with `reservation:read:any` can page/filter statuses, no customer contact details are displayed, and users without that permission receive an authorization error.
- Open `/contact` while signed out and signed in. Confirm it routes account issues to sign-in/private support and never displays an invented email or phone contact.
- Request `/api/v1/openapi.json`; compare each documented method with registered routes, especially uploads, account settings, privacy, inventory, notifications, pharmacy staff and admin operations. Verify public/optional-auth operations are distinguishable from cookie-authenticated routes.

## Setup checks

- Confirm environment variables fail closed when MongoDB URI or JWT secrets are missing/short.
- Start MongoDB as a replica set; verify API health and database connection.
- Bootstrap one super administrator using unique credentials; confirm a second run makes no account changes and an ordinary existing account is never promoted.
- Register a customer and pharmacy owner. In development, use the returned email verification token; verify it once, then confirm replay fails.

## Customer

- Search without location permission; search by brand, generic name and composition.
- Repeat with browser location denied and then granted. Confirm distance/radius changes only after location is chosen.
- Review `RECENTLY_UPDATED`, `NEEDS_CONFIRMATION`, `STALE_WARNING` and older inventory labels. Only recent items may be requested; expired and unapproved pharmacy stock never appears.
- Submit a reservation, repeat with the same `Idempotency-Key`, inspect own reservation history, cancel eligible request, and attempt to access another customer's id.
- Confirm reservation displays a request-to-pharmacy message and never a payment/checkout flow.
- Open `/profile`, edit the name and phone, and confirm the updated name appears in the header after saving. Remove the phone and confirm another account's phone cannot be claimed. Attempt to submit `roles`, another account ID, unknown fields and unknown saved-location IDs; the settings endpoint must reject them.
- Add, edit and remove saved locations using PIN only, coordinates only and both. Check zero-valued coordinates, latitude/longitude bounds, missing coordinate partners, malformed PIN codes, more than ten entries, duplicate IDs and multiple defaults. Verify PIN-only locations do not acquire invalid GeoJSON defaults.
- Save a default location, a custom radius such as 7 km and map view. Open search and confirm all three apply, search works without granting browser location, and the map radius selector retains the custom value. Switch saved locations and verify the request parameters and displayed results. Deny browser location, then grant it; confirm old saved PIN filters are cleared. Choose a saved location while a browser permission request is pending; the eventual browser response must not replace the newer choice.
- Load settings in two browser tabs and save different edits. The later stale save must return 409 and preserve its local draft; reload must offer to discard unsaved changes. Attempt to read or mutate another account's locations through modified URLs/payloads and confirm this remains impossible.
- Search while signed in and confirm recent searches appear on the dashboard and belong only to that account. Clear history and inspect the audit event; it must contain no medicine names. Opt out of history while issuing concurrent searches; confirm previous history is deleted, no search survives the opt-out transaction, and later searches are not recorded. Re-enable recording and confirm only new searches appear. Confirm privacy and account settings responses use `Cache-Control: no-store`.
- Inspect HTTP logs after searching with a PIN/coordinates and an account token in a query string. Logs must contain paths without query strings and must not expose request cookies or response `Set-Cookie` values. Confirm externally configured proxy/access logs use equivalent filtering during deployment.

## Pharmacy owner/staff

- Create a pharmacy profile, upload a valid private licence document and submit. Confirm the file is not retrievable at a public URL.
- As admin, download the document through the authenticated review endpoint; reject/approve with reason. Confirm only approved active profile appears in public search.
- Add two batches with different expiry dates. Correct quantity and verify stock movement history.
- Attempt a quantity correction below reserved quantity and confirm it fails.
- Open Pharmacy > Team and add an existing account with inventory read permission only; confirm they can read inventory but cannot add/correct it. Assign a pharmacist and verify that the pending profile cannot confirm reservations.
- Confirm owner/staff cannot read another pharmacy inventory/reservations.

## Reservation concurrency

- Create two customer requests competing for the same final unit. Confirm at most one allocation succeeds.
- Reject/cancel a pending request; verify reserved quantity returns exactly once.
- Confirm, mark ready and collect. Verify on-hand decreases exactly once and repeated collection does not decrement again.
- Let a pending hold and a confirmed pickup deadline pass; run the operational sweep and verify state and movement history.
- Confirm transactions operate on the configured replica set. Standalone MongoDB is expected to reject transactional writes.

## Admin, pharmacist, support and alerts

- Open `/admin/catalogue` as an administrator with `medicine:manage`. Create categories, search/paginate them, rename, archive and reactivate them. Duplicate names differing by case, repeated spaces or NFKC-equivalent characters must conflict. Public categories must hide archived records. Missing catalogue permission and other roles must be denied even through direct API calls.
- Create and edit an exact catalogue medicine, including brand, generic/composition, strength, form, manufacturer, pack, aliases and category links. Verify input lengths, unknown fields, alias/category count limits and invalid references. New links to archived categories must fail; retaining an existing archived link must work. Switch catalogue tabs and confirm unsaved drafts remain available; refresh the category chooser after creating a category.
- Open the public medicine page from a search result. Compare all identity fields to the catalogue and follow the exact-medicine availability link. Confirm the request uses the exact ID, supports long names and preserves saved PIN/coordinate defaults. Missing, inactive, malformed and hidden demo IDs must show errors without broad-match fallback or a persistent spinner. Edit the search text to start a new query after an invalid selection.
- Verify a classification only with a source reference and an explicit review. Inspect the recorded actor/date and audit before/after classification/source metadata. Changing class/source in the form clears the review checkbox. Withdraw verification and confirm public detail, suggestions, search results and catalogue list all show UNVERIFIED. Legacy values without complete review metadata must remain UNVERIFIED. Demo medicine reviews must be rejected; public responses must not expose internal editor/reviewer IDs.
- Edit the same medicine or category in two tabs. The stale save must return 409 and retain its local draft until explicitly discarded. Deactivate a medicine and confirm public list/detail/suggestions/search exclude it, inventory references and historical reservations remain intact, and new stock/import confirmation cannot use it.
- Add stock, then attempt to change the referenced medicine's name/strength/form/pack/manufacturer/composition identity. The editor must disable those fields, and direct mutation must return MEDICINE_IDENTITY_LOCKED. Alias/category/review/active changes must remain permitted. Repeat with legacy inventory and reservation-only references.
- Race the first stock addition against an identity edit, and race import confirmation against a catalogue revision change. One operation must conflict or retry safely; no batch may silently use a different selected product. A stale import must roll back all rows, movements and the committed job claim and require a fresh preview. These scenarios require a replica-set database and have not been executed.

- Start the manually configured application against an empty disposable replica-set database and inspect Role/Permission catalogue creation. Restart after changing one policy and confirm its permissions and revision are preserved. In production configuration, confirm startup refuses missing/non-unique authorization indexes; provision the documented unique indexes before repeating.
- Open `/admin/users`, search by name/email, paginate and edit an ordinary account with a reason. Try malformed roles, empty role arrays, unknown fields, stale access revisions, demo administrator appointments and appointments without verified email. Confirm failures preserve the prior roles/status and show an actionable error. Inspect successful audit records and notifications, then confirm the target's old access/refresh/reset tokens fail and local connected sockets disconnect.
- As an ordinary ADMIN, try to appoint ADMIN/SUPPORT_ADMIN/SUPER_ADMIN, modify an existing administrative account, edit role policies and change your own access. These must fail even through manually altered API requests. As SUPER_ADMIN, appoint a verified active real account and confirm permitted workspaces appear only after signing in again.
- Edit the same user in two tabs, and add a pharmacy team role concurrently with an administrator save. Stale saves must return 409 instead of overwriting the new access. Required active assignment/ownership roles cannot be removed until the corresponding relationship is resolved. Confirm pharmacy creation atomically records its owner role, staff assignment and audit.
- With two active super administrators, issue concurrent requests to suspend or demote each other. At most one such change may commit; the later transaction must see the actor's changed authority. Attempt to remove or suspend the final active super administrator and confirm it fails. Confirm failure creates no partial access/audit/notification changes.
- In `/admin/access`, change one policy and confirm another unsaved policy draft is preserved. Concurrent edits to the same role must reject the stale revision. Try wildcard or administrative permissions on CUSTOMER/tenant roles; ceilings must reject them. SUPER_ADMIN cannot be edited and fixed customer ownership permissions cannot be removed.
- Revoke ADMIN `inventory:read:any` and call the inventory API directly; role labels must not bypass the revocation. Keep `report:read` and verify authorized reports remain available as a separate permission. Grant `inventory:write:any` explicitly and confirm administrative inventory writes require it. Restore the intended policy afterwards.
- Revoke owner inventory access while its pharmacy assignment still contains `*`; inventory APIs and returned pharmacy capabilities must deny that action. Revoke pharmacist reservation review while retaining verified evidence; verification alone must not bypass the policy. Staff actions require both the effective policy and assignment permission. Test another pharmacy ID on all these paths.
- Revoke `support:manage` from an agent's only qualifying role. The next request must deny inbox/agent/status access while preserving their own ticket access; removed agents must not be offered as assignees or notified through manager fan-out. Switch browser focus to refresh navigation permissions.

- Verify non-admin roles are denied admin APIs even if the client route is manipulated.
- Approve/reject/suspend a pharmacy; attempt invalid state and missing document/number approval.
- Verify an assigned pharmacist profile as admin, then confirm only that verified assigned pharmacist can perform review actions.
- Create support ticket, add comments as requester and support admin, update state and resolution notes.
- Seed demo data in a disposable local database; confirm demo results hidden by default. Enable demo discovery and confirm explicit labels, no phone, and no reservations. Remove only records tagged `isDemo`.
- Set low stock and near expiry batches, wait for or invoke the sweep, and check duplicate suppression and notifications.

## Staff lifecycle and verification boundaries

- Edit a staff member from inventory read to update permission; inspect the pharmacy workspace before and after refresh. Verify the server still denies unauthorized actions when called directly.
- Add an existing member twice: the second request must return a conflict without duplicate assignments. Remove and restore the member; the same pharmacy/user assignment is reactivated.
- Attempt to edit or delete an owner assignment directly through the API; both must fail.
- Remove a member assigned to two pharmacies; verify only the selected pharmacy loses access and that another pharmacy owner cannot alter this assignment.
- Assign the pharmacist role to a customer, submit registration evidence through the supported application flow, then attempt to verify that profile while logged in as the pharmacist. The verification API must deny the request. Verify as an administrator instead.
- Add a previously verified pharmacist to another pharmacy; verify the pharmacist link is updated without changing verification status, and revoke it to remove pharmacy access.
- Inspect audit logs and in-app notifications for add, update, restoration and removal. Transactions require the documented MongoDB replica set.

- Before the expiry worker runs, attempt to mark ready or collect after the pickup deadline or batch expiry. The API must reject the transition; suspended pharmacies must also be unable to advance requests.

## Account recovery and sessions

- In development, register and confirm the returned verification token; open the verification page and request a replacement after the one-minute cooldown. Confirm the previous token fails and the new token succeeds once.
- With a configured Resend account and verified sender, register and request a password reset; check that links use `CLIENT_URL`, expire as documented, and do not appear in server logs. Simulate delivery failure and inspect the operational log without exposing tokens. Delivery is not queued.
- Reset a password and confirm the same token cannot be used again, old access/refresh cookies are rejected, the current socket disconnects, and the new password works. Suspend and reactivate an account and confirm its old tokens remain invalid. Check concurrent use of a refresh token and of each one-time token; at most one request should succeed.
- Check `/auth/me`, login and refresh return the same `id` and verification fields. Verify concurrent expired-session API requests share one refresh in a browser tab. Review multi-tab behavior separately.
- Confirm production startup rejects the console email provider and missing Resend configuration. Do not use real provider credentials in automated local tests.

## Batch editing, stock alerts and expiry recovery

- Open the pharmacy workspace, expand an inventory item and inspect batch quantities, reserved amounts, expiry dates and prices. Confirm read-only staff can view but cannot change any batch or threshold.
- Change a batch quantity and check the corresponding stock movement. Attempt to reduce it below reserved quantity and to edit an expired or inactive batch; the API should reject each attempt. Check expiry dates and prices and reject selling prices above MRP.
- Set a low-stock threshold and confirm a sweep creates the appropriate alert when availability falls to or below it. Confirm threshold updates do not change the inventory freshness timestamp.
- Create pending and confirmed reservations tied to a batch that expires before pickup; confirm a sweep expires them, releases allocations and records movements even if the batch was already deactivated. Confirm repeated sweeps do not create duplicate expired-stock movements.
- With a disposable dataset larger than earlier fixed limits, check that later records receive alerts and that an inconsistent reservation does not prevent other records from processing. Run two API instances and verify job leases prevent overlapping work; leases do not provide exactly-once execution.
- Create two reservations for the same customer without an idempotency key, then replay a separately keyed request. Both unkeyed requests should be allowed if stock exists, and the keyed replay should return the original request. Inspect the partial index and migration notes before running against an existing database.

## Discovery controls and matching

- Search by each supported field and combine name with strength or form. Check case-insensitive partial matching, keyboard suggestion selection, and a common spelling error. Approximate matches must be clearly labelled and never replace the query automatically. Check demo suggestions/results are hidden unless demo discovery is enabled.
- Create multiple strengths, forms and pack sizes. Price sorting must reject a mixed catalogue result set and work after selecting one exact medicine. Confirm each result includes the batch price, MRP when present, product details, pharmacy contact and listed weekly hours. Verify no substitution advice is implied.
- Use location permission, clear it, change radius, add a PIN, and change freshness and availability filters. Confirm the displayed results update, old requests cannot overwrite new filters, pages can be navigated, and bounded searches disclose their limits. Test map recentering when location or page changes.
- Request more than one unit, try an invalid quantity and retry a simulated lost response. Verify a retry of the same request does not create a second reservation; changing the requested quantity starts a new request. Confirm demo or stale results cannot be requested.

## Pharmacist evidence and review

- Assign a pharmacist account to a pharmacy. Submit registration and council details, then upload a valid PDF, PNG or JPEG. Try mismatched content, an oversized file and an unauthorized account; each must be rejected. Confirm direct public file URLs do not work and that only the applicant and authorized administrators can download the evidence.
- Verify that no administrator can approve a pending application without registration details and an existing evidence file. Attempt to review the same administrator's own pharmacist profile; it must be denied.
- Confirm legacy VERIFIED profiles with no evidence cannot perform professional actions and must be resubmitted. Open an application as an administrator, change the application or upload new evidence in another session, then submit the old revision. The review must fail with 409. Review the latest revision, inspect its audit history and notification, and verify only an actively assigned verified pharmacist can access professional transitions.
- Reject a profile without a reason, then with a reason. Confirm the applicant sees the reason and can resubmit details and evidence. Editing a verified profile must return it to pending and remove the old evidence reference.
- In a verified assigned pharmacist workspace, review and confirm an eligible request with an acknowledgement and note, then mark it ready and collected. Do not enter patient or prescription details in notes. Confirm API permissions still prevent ordinary staff from professional actions and that a pharmacist confirmation without the required review attestation is rejected.

## Support conversations and assignment

- As two different customers, create tickets and confirm neither can list, open or comment on the other's ticket even when guessing its ID. Create a ticket from a pharmacy account with an assigned pharmacy; verify a nonassigned user cannot associate a private unapproved pharmacy.
- As a support manager, filter the inbox, assign an active support agent, change priority, reply and resolve with notes. Confirm ordinary users cannot list agents, assign tickets, change priority or change status through the API. An inactive or non-support assignee must be rejected.
- Attempt to resolve/close without notes or use an invalid transition. Open the same ticket in two sessions; save one revision and confirm an edit using the old revision fails with 409. Refresh the ticket and retry.
- Reply as requester after resolution or closure; verify it reopens, its prior resolution remains in history, and new resolution notes are required when it is resolved again. Confirm support agents must reopen before replying to resolved/closed tickets.
- Check new, assigned, updated and replied-to ticket notifications for the intended recipients, open each link, and verify notification text does not include conversation contents. Confirm requester replies notify the assignee, or the support team when the assignee is unavailable.
- Verify pagination and message limits, and confirm requester, comment author, assignee and status-history names display correctly for both new and legacy records. Production indexes must be provisioned explicitly.

## Pharmacy and platform reports

- Give two pharmacies distinct inventory, batches, movements and reservations. Verify an authorized owner or report-enabled staff member can access only their assigned pharmacy; an unassigned or read-disabled user must be denied, including when changing the query parameter directly. Verify a legacy pharmacist without evidence cannot rely on pharmacist verification for report access.
- Compare snapshot quantities to active unexpired batches minus reservations, including unavailable items, low thresholds, expiring batches and inactive expired batches. Compare CSV availability to public stock status and expiry; test cells beginning with formula characters and verify they are neutralized; demo rows must be marked.
- Filter by medicine, status and UTC date boundaries; verify inventory/expiry remain current snapshots while request/movement lists use creation dates. Check pagination, invalid date ranges, more than 366 days, and completion share semantics. Confirm reservation rows contain no customer IDs, names or notes.
- Create request groups with fewer than five distinct customers and with at least five. Confirm suppressed groups do not appear even when one customer submits repeatedly; confirm the report labels requests as requests rather than sales. Search activity should omit raw queries and identities and suppress totals below five distinct authenticated users. Compare filtered reports and note suppression is not a formal anonymity guarantee.
- Confirm admin reports deny non-admins, exclude demo users/pharmacies/medicines/reservations, and show N/A for user/search metrics when their attribution is unavailable. Confirm reports and CSV exports create audit records. Provision report indexes in a disposable database before measuring performance.

## Audit and account-detail verification (not executed)

After the developer completes setup, verify these scenarios manually. No checks in this section were run during implementation.

1. With an existing ADMIN policy, confirm startup preserves permissions. `audit:read` alone must not return any group. As SUPER_ADMIN, explicitly grant selected group permissions at `/admin/access`; confirm new policies default to pharmacy/catalogue/reports with projected details.
2. Without audit access, exercise list/options/detail directly and expect 403. With only catalogue access, confirm all list results and option values are catalogue scoped. Explicit security family/action filters must return 403; a known security event detail ID must return 404, as must a missing ID. Unknown action prefixes must be super-only.
3. Confirm list responses never include metadata/IP, even as SUPER_ADMIN. Remove `user:read` while retaining audit access and confirm actor names disappear. Remove detail permission and confirm detail metadata is omitted. Only SUPER_ADMIN may receive IP addresses. Exercise direct requests independently of navigation.
4. Inspect event-group metadata projections, including legacy records with nested token/password/private-file-path/email keys, large strings/arrays/objects and deep nesting. Confirm known blocked fields and support message/resolution bodies are absent and display is bounded. Confirm HTML is rendered as text. Free text in allowed fields is not automatically anonymized.
5. Use several pages, including equal creation timestamps, and navigate forward/back. Confirm descending ID tie-breaking and preservation of the first cutoff. Append ordinary new events between pages; refresh to include them. Confirm empty/end pages and page sizes 25/50/100. No strict snapshot guarantee applies to backdated database writes.
6. Tamper with a cursor, reuse it for another account/filter/page size/group policy, or let it expire beyond one hour. Expect `400 INVALID_AUDIT_CURSOR`; refresh to recover. Confirm invalid IDs, unknown query fields, invalid calendar days, future end dates and intervals exceeding 366 days fail. Default interval is 30 UTC days. Options reject cursors and cap suggestions at 200.
7. Confirm list/detail reads generate scoped `audit.logs.viewed`/`audit.event.viewed` records. Metadata must not contain the signed cursor. Options do not log another event. Check no-store response headers and query-string omission from request logs.
8. Follow a user-directory or permitted audit-actor link. Confirm account details exclude hashes/tokens, saved locations, searches and support conversations. Without pharmacy review/management authority, assignments and count must be null. With it, verify revoked/active assignment pagination, deleted pharmacy references and actor/resource activity links, all constrained by current audit scope.
9. Revoke permissions while the screens are open and refocus the application. Confirm fresh API requests reject revoked access and details are refreshed or removed. Check invalid/missing account links, reload controls, UTC filter labels, local event timestamps, mobile filters and keyboard navigation.

