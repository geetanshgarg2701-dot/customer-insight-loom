# Decision: error tracking

Date: 2026-11-15

## Decision

Sentry is out of this project. PostHog error tracking is in.

## Why

The Sentry trial has expired, and the project has a rule of no cost beyond the Claude plan. PostHog is already in the stack for product analytics, so error tracking adds no new vendor and no new account.

## Status

- INFERRED: PostHog error tracking is available on the free plan. Not yet checked against PostHog's current pricing page.
- UNVERIFIED: the free usage limits for error tracking. Check them before wiring it up, and confirm there is no card on file.
- Not yet wired into the app. Nothing in the repo sends errors anywhere today.

## Before it goes live

1. Read PostHog's current free limits for error tracking and note them here with the date.
2. Make sure error payloads cannot carry customer text. The redaction module covers quotes, but an unhandled error can include request data. Strip or truncate messages before they are sent.
3. Add a test that a thrown error with an email address in its message does not reach the tracker unredacted.

## Rule going forward

Sentry is not used in any plan or project.
