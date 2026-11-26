# RBAC matrix

Authorization middleware reads effective permissions from MongoDB Role policies on each authenticated request. Built-in role identities, defaults and permission ceilings are defined in `server/src/services/rbacCatalog.ts`. Policies can grant only implemented actions within each role's ceiling. Pharmacy actions additionally require either the appropriate platform-wide permission or an active matching `PharmacyStaff` assignment; assignment permission strings and pharmacist verification are checked by `services/pharmacyAuthorization.ts`.

The table describes default policies. A super administrator can change permitted policy subsets at `/admin/access`; the effective result may therefore be more restrictive. ADMIN starts with inventory read access and may be explicitly granted `inventory:write:any` within its ceiling.

| Capability | Super admin | Admin | Support admin | Customer | Pharmacy owner | Verified pharmacist | Pharmacy staff |
|---|---:|---:|---:|---:|---:|---:|---:|
| Public medicine/pharmacy search | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Create own customer reservation | — | — | — | ✓ | if also customer | if also customer | if also customer |
| Read/cancel own reservations | ✓ | ✓ | ✓ | ✓ | own customer records | own customer records | own customer records |
| Pharmacy inventory read/write | all | read:any; optional write:any | — | — | assigned pharmacy | assigned pharmacy | assigned + inventory permission |
| Pharmacy reservation review/update | all | all | — | — | assigned pharmacy | verified + assigned pharmacy | read-only/permission limited |
| Create pharmacy profile | yes | if also owner | no | no | own account | no | no |
| Review/approve pharmacies | ✓ | ✓ | — | — | — | — | — |
| Download private licence documents | ✓ | ✓ | — | — | — | — | — |
| User activation management | other accounts | non-admin accounts | no | no | no | no | no |
| Medicine catalogue write | ✓ | ✓ | — | — | — | — | — |
| Support tickets | all | all | manage | own | own | own | own |
| Role/permission administration | policies and other accounts | non-admin account roles | no | no | assign staff within own pharmacy | no | no |
| Audit log read | ✓ | ✓ | — | — | — | — | — |

## Notes and limits

- Owners may invite an existing account as PHARMACIST or PHARMACY_STAFF only within their pharmacy. That does not verify a pharmacist. Reservation professional actions additionally require a `VERIFIED` pharmacist profile linked to the pharmacy.
- Only a super administrator may appoint or modify ADMIN, SUPPORT_ADMIN or SUPER_ADMIN accounts. New appointments require an active account with verified email, and demo accounts are ineligible. The bootstrap remains an explicit one-time process that refuses to promote an existing ordinary account.
- Pharmacy inventory, staff, and reservation routes verify the target pharmacy assignment; the frontend workspace selector is not trusted.
- Role policies are edited in MongoDB through the audited super-administrator interface. SUPER_ADMIN wildcard authority is immutable. Basic CUSTOMER search/profile/own-reservation permissions are fixed; public search and access to an authenticated account's own profile remain intrinsic. The seven built-in roles are fixed identities; arbitrary permission strings or custom privilege-bearing roles are not accepted.

- Pharmacist registration approval uses the administrative `pharmacist:review` permission, held by ADMIN and SUPER_ADMIN only. PHARMACIST grants no self-verification permission.
- Team management rejects edits/removal of owner assignments, supports restoration of revoked members, and accepts only the documented staff permission allowlist. Account role labels may remain after removal; active pharmacy assignments still determine access.

- Pharmacist evidence is private and downloadable only by its applicant or an ADMIN/SUPER_ADMIN reviewer. An administrator cannot review their own pharmacist application. A current pending revision, registration details and an existing private evidence file are required for verification. Professional permissions require the verified profile to retain its evidence path and upload timestamp; legacy verified profiles without them must be resubmitted for review. Rejection/revocation requires a reason.

- Support ticket conversations and resolution notes are visible to their requester and roles with `support:manage`. Only those roles can list agents, assign tickets or change priority/status. A requester reply may reopen their own resolved/closed ticket; other users receive 404 for its details and comments.

## Access administration

### Audit permissions

Audit access requires `audit:read` and at least one event-group permission. New ADMIN policies default to `audit:read:pharmacy`, `audit:read:catalogue`, `audit:read:reports` and `audit:read:details`. A super administrator may additionally grant ADMIN `audit:read:security` and `audit:read:support`. IP (`audit:read:ip`) and unknown system events (`audit:read:system`) are reserved for SUPER_ADMIN. Other built-in roles have no audit access in their ceilings. The matrix's audit row is subject to these group restrictions.

Summary lists exclude metadata and IP even for SUPER_ADMIN. Metadata details need `audit:read:details` and always receive bounded field projection. Actor names additionally need `user:read`. Each list, suggestions and detail request independently applies current permissions. A user profile's pharmacy assignments require `user:read` plus `pharmacy:review` or `pharmacy:manage`; directory access alone does not reveal assignments.

**Upgrade:** startup preserves existing role permission arrays. It does not add these new grants to an existing ADMIN policy. A super administrator must review the policy at `/admin/access` and explicitly save the required group/detail grants with its revision and a reason. An existing policy containing only `audit:read` receives no events and the list returns 403 until configured. Group changes invalidate existing cursors; refresh the viewer. No policy migration was executed during development.

`/admin/users` provides directory search, role assignment and activation controls. Non-super administrators need the applicable `user:read`, `user:roles:manage` and/or `user:manage` policy permissions and can only manage non-administrative accounts. No administrator may modify their own access. Active pharmacy assignments and pharmacy ownership prevent removal of required account roles. Changes require a current access revision and an audit reason. They commit audit/notification records with the new roles/status, revoke access/refresh/reset tokens and disconnect local sockets. A serialized control-record write and fresh actor check protect concurrent administrator changes and the last active super administrator.

Policy changes affect the next request, including inventory/report scopes, reservation review, support agent eligibility and returned pharmacy capabilities. Multiple roles contribute a union of allowed permissions; tenant assignment and professional checks still apply to the target pharmacy. Policy editing cannot grant pharmacist verification, create a pharmacy assignment, or turn a tenant permission into platform access. Client permissions are presentation data and are never accepted as authorization input.
