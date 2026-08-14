# Security Hardening Plan

This plan addresses several security hardening improvements related to database access, admin verification, and general best practices.

## User-facing changes
- No direct user-facing changes, but the application will be more secure.
- Admin functionality will have more robust server-side validation.

## Technical details
- **Fix recursive RLS issues**: Update `has_role` function to be more robust.
- **Strict Admin Verification**: Ensure all admin-only server functions use a unified, secure verification method.
- **RLS Policy Audit**: Audit and tighten RLS policies for `user_roles` and `mcp_servers` to prevent unauthorized access.
- **Secure Server Functions**: Ensure `requireSupabaseAuth` is used correctly and that sensitive data is never leaked in errors.
- **MCP Server Security**: Encrypt or strictly control access to `api_key` in the `mcp_servers` table.

## Steps
1. Audit all RLS policies in migrations.
2. Refactor `isAdmin` and `assertAdmin` to use `has_role` function securely.
3. Update `src/lib/admin.functions.ts` to use `requireSupabaseAuth` consistently while handling the "no session" case gracefully.
4. Verify `GRANT` statements exist for all tables.
5. Add server-side validation for MCP server URLs and keys.
