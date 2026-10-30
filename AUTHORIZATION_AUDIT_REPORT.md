# DEMS Authorization Audit Report

**Date:** 2026-10-26
**Auditor:** Devin Security Audit
**Scope:** Complete frontend and backend authorization review

---

## Executive Summary

This audit reveals **CRITICAL authorization vulnerabilities** across the DEMS application. The current implementation allows unauthorized access to routes and APIs through direct URL navigation. Users can access interfaces and perform actions outside their permitted role scope.

### Critical Findings:
1. **Frontend route guards allow cross-role access** - Officers can access citizen routes, admins can access officer routes, super_admins can access admin routes
2. **Backend middleware grants super_admin blanket access to admin routes** - violates strict role isolation requirement
3. **Object-level access control is missing** - Organization admins can potentially access other organizations' data
4. **Layout isolation is vulnerable** - Direct URL navigation can bypass sidebar restrictions

---

## 1. Frontend Route Inventory & Authorization Issues

### Current Route Configuration (App.jsx)

| Route Path | Current Allowed Roles | Issue | Required Permitted Roles |
|------------|---------------------|-------|---------------------------|
| `/` | Public | ✅ OK | Public |
| `/public/*` | Public | ✅ OK | Public |
| `/auth/wallet-login` | Public | ✅ OK | Public |
| `/auth/email-verification` | Authenticated | ✅ OK | Authenticated (any role) |
| `/citizen/*` | `['citizen', 'officer', 'admin']` | ❌ **CRITICAL** - Officers and admins can access citizen routes | `['citizen']` |
| `/officer/*` | `['officer', 'admin']` | ❌ **CRITICAL** - Admins can access officer routes | `['officer']` |
| `/admin/*` | `['admin', 'super_admin']` | ❌ **CRITICAL** - Super admins can access admin routes | `['admin']` |
| `/superadmin/*` | `['super_admin']` | ✅ OK | `['super_admin']` |
| `/invitation/*` | Public | ✅ OK | Public (with token validation) |

### Detailed Route Breakdown

#### Public Routes (No Authentication Required)
- `/` - Landing page
- `/public` - Landing page (alias)
- `/public/about` - About page
- `/public/features` - Features page
- `/auth/wallet-login` - Wallet login
- `/auth` - Redirect to wallet login
- `/invitation/admin/:token` - Admin invitation acceptance
- `/invitation/employee/:token` - Employee invitation acceptance

#### Citizen Routes (Should be: citizen ONLY)
- `/citizen` - Citizen dashboard
- `/citizen/dashboard` - Citizen dashboard
- `/citizen/upload-evidence` - Upload evidence
- `/citizen/evidence-vault` - Evidence vault
- `/citizen/evidence/:evidenceId` - Evidence details
- `/citizen/profile` - Profile

**Issue:** Currently allows `['citizen', 'officer', 'admin']` - officers and admins can access citizen interface

#### Officer Routes (Should be: officer ONLY)
- `/officer` - Officer dashboard
- `/officer/dashboard` - Officer dashboard
- `/officer/upload-evidence` - Upload evidence
- `/officer/pending-reviews` - Pending reviews
- `/officer/modifications` - Modification requests
- `/officer/chain-of-custody` - Chain of custody
- `/officer/evidence-tracking` - Evidence tracking

**Issue:** Currently allows `['officer', 'admin']` - admins can access officer interface

#### Organization Admin Routes (Should be: admin ONLY)
- `/admin` - Admin dashboard
- `/admin/dashboard` - Admin dashboard
- `/admin/officer-approval` - Officer approval
- `/admin/users` - User management
- `/admin/groups` - Groups management
- `/admin/evidence` - Organization evidence
- `/admin/evidence/:evidenceId` - Evidence details
- `/admin/quarantine` - Quarantine review
- `/admin/upload-requests` - Upload approval requests
- `/admin/upload-requests/:requestId` - Upload request details
- `/admin/pending-uploads` - Upload approval requests (alias)
- `/admin/pending-uploads/:requestId` - Upload request details (alias)
- `/admin/modifications` - Modification requests
- `/admin/organization` - Organization settings
- `/admin/audit-logs` - Audit logs

**Issue:** Currently allows `['admin', 'super_admin']` - super admins can access organization admin interface

#### Super Admin Routes (Should be: super_admin ONLY)
- `/superadmin` - Super admin dashboard
- `/superadmin/dashboard` - Super admin dashboard
- `/superadmin/users` - Global users
- `/superadmin/evidence` - Global evidence
- `/superadmin/evidence/:evidenceId` - Evidence details
- `/superadmin/blockchain` - Blockchain monitoring
- `/superadmin/storage` - Storage monitoring
- `/superadmin/retention` - Retention management
- `/superadmin/upload-requests` - Upload approval requests
- `/superadmin/upload-requests/:requestId` - Upload request details
- `/superadmin/pending-uploads` - Upload approval requests (alias)
- `/superadmin/pending-uploads/:requestId` - Upload request details (alias)

**Status:** ✅ Correctly restricted to `['super_admin']`

---

## 2. Backend API Route Inventory & Authorization Issues

### Authentication Middleware (authMiddleware.js)
- ✅ `protect` - Validates JWT token, attaches user to req.user
- ✅ `attachUserIfPresent` - Optional auth for public endpoints
- ✅ Suspends suspended accounts

### Role Middleware (roleMiddleware.js)
**CRITICAL ISSUE:** Line 10-13 grants super_admin access to all admin routes:

```javascript
// Super admin has access to all admin routes
if (req.user.role === 'super_admin' && roles.includes('admin')) {
    console.log('[RBAC] Access granted - Super admin accessing admin route');
    return next();
}
```

This violates the requirement: "Super Admin: Can access only the authorized Super Admin interface"

### API Route Authorization Matrix

| API Endpoint | Current Authorization | Issue | Required Authorization |
|--------------|----------------------|-------|----------------------|
| **Auth Routes** |
| `POST /api/auth/nonce/:walletAddress` | Public | ✅ OK | Public |
| `POST /api/auth/verify` | Public | ✅ OK | Public |
| `GET /api/auth/me` | `protect` | ✅ OK | Authenticated |
| `PUT /api/auth/profile` | `protect` | ✅ OK | Authenticated |
| `POST /api/auth/send-email-otp` | `protect` | ✅ OK | Authenticated |
| `POST /api/auth/verify-email-otp` | `protect` | ✅ OK | Authenticated |
| **Admin Routes** |
| `POST /api/admin/verification-request` | `protect, authorizeRoles('citizen', 'officer', 'admin')` | ✅ OK | citizen, officer, admin |
| `POST /api/admin/verification-request-by-code` | `protect, authorizeRoles('citizen', 'officer', 'admin')` | ✅ OK | citizen, officer, admin |
| `GET /api/admin/verification-requests` | `protect, authorizeRoles('admin')` | ⚠️ super_admin can access | admin only |
| `POST /api/admin/verification-requests/review` | `protect, authorizeRoles('admin')` | ⚠️ super_admin can access | admin only |
| `POST /api/admin/membership-applications/review` | `protect, authorizeRoles('admin')` | ⚠️ super_admin can access | admin only |
| `GET /api/admin/users` | `protect, authorizeRoles('admin')` | ⚠️ super_admin can access | admin only |
| `GET /api/admin/platform-users` | `protect, authorizeRoles('super_admin')` | ✅ OK | super_admin only |
| `GET /api/admin/audit-logs` | `protect, authorizeRoles('admin')` | ⚠️ super_admin can access | admin only |
| `POST /api/admin/upgrade-officer` | `protect, authorizeRoles('admin')` | ⚠️ super_admin can access | admin only |
| **Evidence Routes** |
| `POST /api/evidence/upload` | `protect` | ✅ OK | Authenticated |
| `GET /api/evidence/upload-policy` | `protect` | ✅ OK | Authenticated |
| `POST /api/evidence/finalize/:evidenceId` | `protect` | ✅ OK | Authenticated |
| `POST /api/evidence/:evidenceId/blockchain-failed` | `protect` | ✅ OK | Authenticated |
| `POST /api/evidence/:evidenceId/retry-blockchain` | `protect` | ✅ OK | Authenticated |
| `GET /api/evidence/wallet/:address/balance` | Public | ✅ OK | Public |
| `GET /api/evidence/my-files` | `protect` | ✅ OK | Authenticated |
| `GET /api/evidence/organization` | `protect, authorizeRoles('admin')` | ⚠️ super_admin can access | admin only |
| `GET /api/evidence/platform` | `protect, authorizeRoles('super_admin')` | ✅ OK | super_admin only |
| `GET /api/evidence/download/:id` | `protect` | ⚠️ Missing object-level check | Authenticated + ownership check |
| `GET /api/evidence/case/:caseId` | `protect, authorizeRoles('officer', 'admin', 'citizen')` | ✅ OK | officer, admin, citizen |
| `GET /api/evidence/:id` | `protect` | ⚠️ Missing object-level check | Authenticated + ownership check |
| `POST /api/evidence/:id/verify-blockchain` | `protect` | ✅ OK | Authenticated |
| **Controlled Upload Routes** |
| `POST /api/controlled-upload/pending` | `protect` | ✅ OK | Authenticated |
| `GET /api/controlled-upload/pending` | `protect` | ⚠️ Scoped in controller but no role guard | Authenticated (scoped by role in controller) |
| `GET /api/controlled-upload/pending/:requestId/preview` | `protect, authorizeRoles('admin')` | ⚠️ super_admin can access | admin only + org ownership |
| `POST /api/controlled-upload/pending/:requestId/approve` | `protect, authorizeRoles('admin')` | ⚠️ super_admin can access | admin only + org ownership |
| `POST /api/controlled-upload/pending/:requestId/reject` | `protect, authorizeRoles('admin')` | ⚠️ super_admin can access | admin only + org ownership |
| `POST /api/controlled-upload/pending/:requestId/retry-finalization` | `protect, authorizeRoles('admin')` | ⚠️ super_admin can access | admin only + org ownership |
| `GET /api/controlled-upload/pending/:requestId` | `protect` | ⚠️ Missing org ownership check | Authenticated + org ownership |
| **Organization Routes** |
| `GET /api/organization/directory` | `protect, authorizeRoles('super_admin')` | ✅ OK | super_admin only |
| `POST /api/organization/create` | `protect, authorizeRoles('super_admin')` | ✅ OK | super_admin only |
| `POST /api/organization/assign-admin` | `protect, authorizeRoles('super_admin')` | ✅ OK | super_admin only |
| `PUT /api/organization/:organizationId/status` | `protect, authorizeRoles('super_admin')` | ✅ OK | super_admin only |
| `GET /api/organization/active` | `protect` | ✅ OK | Authenticated |
| `GET /api/organization/me` | `protect` | ✅ OK | Authenticated |
| `GET /api/organization/overview` | `protect, authorizeRoles('admin')` | ⚠️ super_admin can access | admin only |
| `PUT /api/organization/settings` | `protect, authorizeRoles('admin')` | ⚠️ super_admin can access | admin only |
| `GET /api/organization/resolve/:code` | `protect` | ✅ OK | Authenticated |
| `GET /api/organization/:organizationId` | `protect` | ⚠️ Missing access control | Authenticated + access control |
| `GET /api/organization/:organizationId/admins` | `protect` | ⚠️ Missing access control | Authenticated + access control |
| **Monitoring Routes** |
| `GET /api/monitoring/blockchain` | `protect, authorizeRoles('super_admin')` | ✅ OK | super_admin only |
| `GET /api/monitoring/storage` | `protect, authorizeRoles('super_admin')` | ✅ OK | super_admin only |
| **Modification Routes** |
| `POST /api/modifications/` | `protect, authorizeRoles('officer')` | ✅ OK | officer only |
| `GET /api/modifications/` | `protect, authorizeRoles('officer', 'admin')` | ⚠️ super_admin can access | officer, admin only |
| `POST /api/modifications/:id/submit-file` | `protect, authorizeRoles('officer')` | ✅ OK | officer only |
| `POST /api/modifications/:id/review` | `protect, authorizeRoles('admin')` | ⚠️ super_admin can access | admin only |
| **Quarantine Routes** |
| `GET /api/quarantine/` | `protect, authorizeRoles('officer', 'admin')` | ⚠️ super_admin can access | officer, admin only |
| `GET /api/quarantine/:id` | `protect, authorizeRoles('officer', 'admin')` | ⚠️ super_admin can access | officer, admin only |
| `POST /api/quarantine/:id/review` | `protect, authorizeRoles('admin')` | ⚠️ super_admin can access | admin only |
| **Group Routes** |
| `POST /api/groups/` | `protect, authorizeRoles('admin')` | ⚠️ super_admin can access | admin only |
| `GET /api/groups/organization` | `protect, authorizeRoles('admin')` | ⚠️ super_admin can access | admin only |
| `GET /api/groups/my-groups` | `protect` | ✅ OK | Authenticated |
| `POST /api/groups/:groupId/members` | `protect, authorizeRoles('admin')` | ⚠️ super_admin can access | admin only |
| `DELETE /api/groups/:groupId/members/:userId` | `protect, authorizeRoles('admin')` | ⚠️ super_admin can access | admin only |
| `DELETE /api/groups/:groupId` | `protect, authorizeRoles('admin')` | ⚠️ super_admin can access | admin only |
| **Invitation Routes** |
| `GET /api/invitations/token/:token` | Public | ✅ OK | Public |
| `POST /api/invitations/admin/create` | `protect, authorizeRoles('super_admin')` | ✅ OK | super_admin only |
| `POST /api/invitations/employee/create` | `protect, authorizeRoles('admin')` | ⚠️ super_admin can access | admin only |
| `GET /api/invitations/pending/:organizationId` | `protect` | ⚠️ Missing org ownership check | Authenticated + org ownership |
| `DELETE /api/invitations/:invitationId/revoke` | `protect` | ⚠️ Missing ownership check | Authenticated + ownership |
| `POST /api/invitations/admin/:token/accept` | `protect` | ✅ OK | Authenticated |
| `POST /api/invitations/employee/:token/accept` | `protect` | ✅ OK | Authenticated |
| `POST /api/invitations/employee/:token/submit` | `protect` | ✅ OK | Authenticated |
| **Analytics Routes** |
| `GET /api/analytics/platform` | `protect, authorizeRoles('super_admin')` | ✅ OK | super_admin only |
| `GET /api/analytics/organization` | `protect` | ⚠️ Missing role guard | admin only |
| `GET /api/analytics/officer` | `protect` | ⚠️ Missing role guard | officer only |
| `GET /api/analytics/citizen` | `protect` | ⚠️ Missing role guard | citizen only |
| **Notification Routes** |
| `GET /api/notifications/` | `protect` | ✅ OK | Authenticated |
| `PUT /api/notifications/:notificationId/read` | `protect` | ✅ OK | Authenticated |
| `PUT /api/notifications/read-all` | `protect` | ✅ OK | Authenticated |

---

## 3. Object-Level Access Control Issues

### Critical Missing Checks:

1. **Evidence Download/View:**
   - `GET /api/evidence/download/:id` - No ownership validation
   - `GET /api/evidence/:id` - No ownership validation
   - Organization admins can potentially view evidence from other organizations

2. **Pending Upload Requests:**
   - `GET /api/controlled-upload/pending/:requestId` - No organization ownership check
   - Organization admins can access other organizations' upload requests

3. **Organization Details:**
   - `GET /api/organization/:organizationId` - No access control
   - `GET /api/organization/:organizationId/admins` - No access control

4. **Invitations:**
   - `GET /api/invitations/pending/:organizationId` - No organization ownership check
   - `DELETE /api/invitations/:invitationId/revoke` - No ownership check

---

## 4. Layout and Sidebar Isolation Issues

### Current Implementation (AppLayout.jsx)

The sidebar navigation correctly shows different items based on role:
- ✅ Citizen: Shows citizen-specific navigation
- ✅ Officer: Shows officer-specific navigation
- ✅ Admin: Shows admin-specific navigation
- ✅ Super Admin: Shows super admin-specific navigation

**However:** Since route guards allow cross-role access, a user can:
1. Navigate to a permitted route (e.g., admin goes to `/admin/dashboard`)
2. Paste a direct URL to another role's route (e.g., `/citizen/dashboard`)
3. The route guard allows access due to incorrect role configuration
4. The sidebar remains in the original role's layout, but the page content renders

This creates a **security bypass** where the UI shows one role's sidebar but displays another role's content.

---

## 5. Root Cause Analysis

### Primary Issues:

1. **Frontend RequireAuth.jsx (Line 18-24):**
   - Route guards have incorrect role arrays
   - Officers and admins can access citizen routes
   - Admins can access officer routes
   - Super admins can access admin routes

2. **Backend roleMiddleware.js (Line 10-13):**
   - Explicitly grants super_admin access to all admin routes
   - This was likely intended for convenience but violates strict role isolation

3. **Missing Object-Level Validation:**
   - Controllers do not validate resource ownership
   - Organization isolation is not enforced at the object level

4. **Analytics Routes Missing Role Guards:**
   - `/api/analytics/organization` - Only checks organizationId, not role
   - `/api/analytics/officer` - No role check
   - `/api/analytics/citizen` - No role check

---

## 6. Required Fixes

### Priority 1: Frontend Route Guards (CRITICAL)

**File:** `dems-frontend-web/src/routes/RequireAuth.jsx`

Changes needed:
1. Line 58: Change `['citizen', 'officer', 'admin']` to `['citizen']`
2. Line 69: Change `['officer', 'admin']` to `['officer']`
3. Line 81: Change `['admin', 'super_admin']` to `['admin']`

**File:** `dems-frontend-web/src/App.jsx`

Update all route guards to match the above changes.

### Priority 2: Backend Role Middleware (CRITICAL)

**File:** `dems-backend-node/middleware/roleMiddleware.js`

Remove lines 10-13 that grant super_admin blanket access to admin routes.

### Priority 3: Backend API Role Guards (HIGH)

Add missing role guards to:
- `GET /api/analytics/organization` - Add `authorizeRoles('admin')`
- `GET /api/analytics/officer` - Add `authorizeRoles('officer')`
- `GET /api/analytics/citizen` - Add `authorizeRoles('citizen')`

### Priority 4: Object-Level Access Control (HIGH)

Add ownership validation to controllers:
- EvidenceController: Validate evidence ownership
- ControlledUploadController: Validate organization ownership
- OrganizationController: Validate organization access
- InvitationController: Validate invitation ownership

### Priority 5: Layout Section Validation (MEDIUM)

**File:** `dems-frontend-web/src/layouts/AppLayout.jsx`

Add validation to ensure the section prop matches the user's role to prevent layout mismatches.

---

## 7. Test Matrix (To Be Executed After Fixes)

### Frontend Route Access Tests

| User Role | Target Route | Expected Result | Status |
|-----------|--------------|-----------------|--------|
| Unauthenticated | `/citizen/dashboard` | Redirect to login | ⏳ |
| Unauthenticated | `/officer/dashboard` | Redirect to login | ⏳ |
| Unauthenticated | `/admin/dashboard` | Redirect to login | ⏳ |
| Unauthenticated | `/superadmin/dashboard` | Redirect to login | ⏳ |
| Citizen | `/citizen/dashboard` | Access granted | ⏳ |
| Citizen | `/officer/dashboard` | Redirect to citizen dashboard | ⏳ |
| Citizen | `/admin/dashboard` | Redirect to citizen dashboard | ⏳ |
| Citizen | `/superadmin/dashboard` | Redirect to citizen dashboard | ⏳ |
| Officer | `/citizen/dashboard` | Redirect to officer dashboard | ⏳ |
| Officer | `/officer/dashboard` | Access granted | ⏳ |
| Officer | `/admin/dashboard` | Redirect to officer dashboard | ⏳ |
| Officer | `/superadmin/dashboard` | Redirect to officer dashboard | ⏳ |
| Admin | `/citizen/dashboard` | Redirect to admin dashboard | ⏳ |
| Admin | `/officer/dashboard` | Redirect to admin dashboard | ⏳ |
| Admin | `/admin/dashboard` | Access granted | ⏳ |
| Admin | `/superadmin/dashboard` | Redirect to admin dashboard | ⏳ |
| Super Admin | `/citizen/dashboard` | Redirect to superadmin dashboard | ⏳ |
| Super Admin | `/officer/dashboard` | Redirect to superadmin dashboard | ⏳ |
| Super Admin | `/admin/dashboard` | Redirect to superadmin dashboard | ⏳ |
| Super Admin | `/superadmin/dashboard` | Access granted | ⏳ |

### Backend API Access Tests

| User Role | API Endpoint | Expected Result | Status |
|-----------|--------------|-----------------|--------|
| Citizen | `GET /api/admin/verification-requests` | 403 Forbidden | ⏳ |
| Officer | `GET /api/admin/verification-requests` | 403 Forbidden | ⏳ |
| Admin | `GET /api/admin/verification-requests` | 200 OK | ⏳ |
| Super Admin | `GET /api/admin/verification-requests` | 403 Forbidden | ⏳ |
| Admin | `GET /api/monitoring/blockchain` | 403 Forbidden | ⏳ |
| Super Admin | `GET /api/monitoring/blockchain` | 200 OK | ⏳ |
| Admin (Org A) | `GET /api/controlled-upload/pending/:requestId (Org B)` | 403/404 Forbidden | ⏳ |
| Admin (Org A) | `GET /api/evidence/:id (Org B)` | 403/404 Forbidden | ⏳ |

---

## 8. Conclusion

The DEMS application has **critical authorization vulnerabilities** that must be fixed immediately:

1. **Frontend route guards allow cross-role access** - This is the most severe issue as it allows any authenticated user to access any interface by pasting URLs
2. **Backend middleware grants super_admin excessive access** - Violates the principle of least privilege
3. **Object-level access control is missing** - Allows potential data leakage between organizations
4. **Some API endpoints lack role guards** - Analytics endpoints can be accessed by any authenticated user

**Recommended Action:** Implement all Priority 1 and 2 fixes immediately before the application is used in production. Priority 3-5 should be implemented as soon as possible to complete the security hardening.

---

## Next Steps

1. ✅ Complete audit
2. ⏳ Implement Priority 1 fixes (Frontend route guards)
3. ⏳ Implement Priority 2 fixes (Backend role middleware)
4. ⏳ Implement Priority 3 fixes (API role guards)
5. ⏳ Implement Priority 4 fixes (Object-level access control)
6. ⏳ Implement Priority 5 fixes (Layout validation)
7. ⏳ Execute test matrix
8. ⏳ Generate final implementation report
