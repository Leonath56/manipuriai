# Security Hardening - Final Polish

Addressing remaining RLS gaps for sensitive tables and ensuring robust admin controls.

## User-facing changes
- Improved data privacy for personal usage and payment records.
- No functional changes to the chat experience.

## Technical details
- **Fix Missing RLS for daily_usage**: Add `INSERT`, `UPDATE`, and `DELETE` policies to the `daily_usage` table to allow authorized users to manage their own usage data (currently only `SELECT` is protected, though `GRANT`s exist).
- **Tighten RLS for user_memory**: Ensure the `user_memory` table is fully protected for all operations.
- **Audit payment policies**: Verify `payments` table has complete RLS for all CRUD operations.
- **Admin Verification refinement**: Ensure `assertAdmin` is used in all sensitive server functions.
- **MCP URL validation**: Strengthen the URL validation logic in `src/lib/mcp-client.server.ts` to prevent bypasses.

## Steps
1. **Migration**: Add missing RLS policies for `daily_usage`, `user_memory`, and `payments`.
2. **Migration**: Ensure `GRANT` statements are complete for all these tables.
3. **Refactor**: Strengthen SSRF protection in `src/lib/mcp-client.server.ts`.
4. **Audit**: Final check of `src/lib/admin.functions.ts` to ensure all handlers use `assertAdmin`.
