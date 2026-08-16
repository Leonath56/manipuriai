# Security Hardening - RLS and Admin verification

Address potential security findings by hardening Row Level Security (RLS) policies and unifying admin verification across the application.

## User-facing changes
- Improved security for user data and administrative functions.
- No visible UI changes, but internal operations are more robust.

## Technical details
- **Unify Admin Verification**: Refactor `isAdmin` in `src/lib/admin.functions.ts` to use a more robust verification method, including standard environment variables.
- **Tighten RLS for Guest Sessions**: Ensure `guest_sessions` and `guest_messages` have strict RLS policies.
- **Audit Table Grants**: Ensure all public tables have proper `GRANT` statements for `authenticated` and `service_role`.
- **Harden MCP Server Security**: Add an additional check for URL uniqueness or ownership if applicable.
- **Fix Potential Recursive RLS**: Verify `has_role` is optimized and used consistently.

## Steps
1. **Migration**: Create a new migration to harden RLS for `guest_sessions` and `guest_messages`.
2. **Migration**: Ensure `GRANT` statements are applied to all sensitive tables.
3. **Refactor**: Update `src/lib/admin.functions.ts` to use consistent env vars and safer token validation.
4. **Validation**: Add a check to ensure `supabaseAdmin` is only used in server-side context via proper imports.
