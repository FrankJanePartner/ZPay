# Authentication, authorization and account-recovery audit

Reviewed: `backend/payments/views.py`, `backend/payments/auth.py`, `backend/payments/models.py`, `backend/payments/serializers.py` and `backend/payments/tests.py`. Date: 2026-10-22.

## Entry points and permission boundaries

- Public: health, register, login, legacy login/migrate/confirm, email verification, recovery request/completion. Authentication disabled explicitly and the auth/recovery endpoints apply scoped throttling.
- Dashboard-only: API credential creation/revocation, recovery email enrollment, logout, dashboard-only operations. Credential kinds are checked at the bearer boundary.
- Payment and send endpoints use owner-filtered querysets; cross-account payment access is covered by regression tests.
- Recovery email enrollment requires both an authenticated dashboard session and the current login secret. The response avoids revealing another user's registered email.

## Recovery lifecycle reviewed

1. Enrollment sends a signed, one-hour verification link to the proposed address; the prior email is embedded and checked before replacement.
2. Verified email is associated with the user and tracked by a digest.
3. Recovery requests require a verified email and an active login credential; public responses do not disclose account existence.
4. Completion validates Django's password-reset token under a database transaction, rotates the login secret, invalidates prior dashboard sessions and changes the unusable password hash to invalidate token replay.
5. Existing regression test confirms old login secrets stop working and recovery token replay is rejected.

## Findings / remaining risks

- **Potential replay:** the email-verification token remains valid until expiry when `prior_email` is unchanged (e.g. verifying the same email again). Repeated verification does not grant access to a new email, but should be made one-time if the verification workflow is hardened further.
- **Concurrency:** email uniqueness is checked in application code. The default Django user model does not enforce case-insensitive email uniqueness in the database; concurrent verification requests could create duplicate email ownership. Add a database uniqueness strategy or normalized-email ownership table before high-volume recovery use.
- **Email delivery:** recovery depends on configured HTTPS dashboard origin and an operational email backend. Failure responses are handled, but production SMTP configuration and deliverability require deployment testing.
- **Rate limits:** scoped throttles protect public auth routes; validate cache-backed distributed throttling and proxy client-IP configuration in production.
- **Recovery endpoint input:** `uid` accepts integer or numeric string. Validate and constrain request data consistently to avoid surprising coercions.
- **Secret exposure:** login secrets are returned only on issue/rotation, and digests are stored in the credential table. Confirm logs, analytics and support tools do not record these values.

## Audit conclusion

The current authorization/recovery flow has meaningful credential-kind, ownership, expiry, throttling and replay protections, and regression coverage. The **review task** is complete; this does **not** certify that all findings are remediated or that production deployment is secure. Findings remain for milestone 13's final security review and remediation.
