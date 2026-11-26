# ADR 0007: Route protection in the composition root, always on

- **Status:** Accepted
- **Context:** Until now every route was open. The TRD (section 6) says authorisation must be enforced in the application layer, not only in the UI, and ADR 0005 defined what a user may do and where. The modules cannot import identity (ADR 0001), so the check has to live where the modules meet.
- **Decision:**
  1. **One middleware, `protect`, in `apps/api/src/security.ts`,** runs before any module. It resolves the caller from the session token, finds the rule for the request in `apps/api/src/access-rules.ts`, and checks it with the same `can()` function the identity module exports. The modules stay unaware of it.
  2. **The rules are one table, one line per route:** public, signed-in, or a permission (plus the name of the path parameter that holds the warehouse id for warehouse-scoped routes). Reading needs `.read`; changing needs `.manage`, `.adjust` or `.transfer`.
  3. **It fails closed.** A request no rule covers gets 401 without a session and 404 with one, and is never passed on, so a route added without a rule is unreachable rather than open. A test reads every module's route table and fails if a route has no rule, or a rule has no route.
  4. **Only two things are public:** `POST /identity/login`, and the health probes, which are mounted before this layer.
  5. **401 means no valid session, 403 means a valid one without the permission or the warehouse.** Denials are logged at warn level with the user, method, path and permission.
  6. **Protection is always on.** There is no switch to turn it off: a setting that defaults to off is easy to forget in a deployment. Local use goes through `npm run create-admin` and `login`; in-memory mode creates an administrator at startup from `DEV_ADMIN_PASSWORD`.
  7. **Idempotency keys are kept per signed-in user.** The middleware order is protect, body parser, idempotency.
  8. **Matching mirrors Express:** case-insensitive, a trailing slash ignored, HEAD treated as GET. Anything that does not match exactly is refused.
- **Consequences:** Anyone who can list warehouses (`locations.read`) sees all warehouses by name, even ones they cannot enter; filtering that list by access is a later refinement. The three identity routes for the caller's own account (`/me`, `/logout`, `/me/password`) read the token again inside the module, so they look the session up twice; handing the resolved caller to the module is a possible tidy-up. The audit trail (P1-2) can now read the caller from the same place.
