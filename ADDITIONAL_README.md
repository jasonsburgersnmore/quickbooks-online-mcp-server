# Additional README: fork improvements

This repository is a fork of [Intuit's QuickBooks Online MCP server](https://github.com/intuit/quickbooks-online-mcp-server). This page tracks improvements developed for a local QuickBooks workflow and what still needs to be brought into this public fork.

## Current status

As of November 4, 2026, the improvements below exist in a separate local checkout; they have **not been committed to this GitHub fork**. This document does not install them or change the behavior of a server cloned from this repository. The upstream README describes the upstream tool set.

## Improvements developed locally

| Area | Local improvement | Status in this fork |
| --- | --- | --- |
| Production authentication | A production OAuth helper validates its configuration and registered HTTPS redirect, uses a state value for the authorization flow, and saves the resulting token data to a separately configured store. An absolute `QUICKBOOKS_TOKEN_STORE_PATH` keeps that store outside the source checkout. | Not published here |
| Tool exposure | Registration can disable create, update, and delete classes with `QUICKBOOKS_DISABLE_WRITE`, `QUICKBOOKS_DISABLE_UPDATE`, and `QUICKBOOKS_DISABLE_DELETE`. `QUICKBOOKS_ALLOWED_MUTATION_TOOLS` narrows which mutation tools may be registered. | Not published here |
| Purchase categorization | A narrow `update_purchase_category` tool targets one Purchase line and its category account. It checks the company, purchase and line identifiers, the expected current category, `SyncToken`, and a snapshot hash before an update. It reads the record back and records an audit result. | Not published here |
| Payment reconciliation | A local, transaction-specific workflow was used to review an existing bank-feed credit, record an approved customer payment, verify its invoice applications, and match the feed item without creating a second deposit. This was a controlled operator procedure, **not** a general payment tool in this fork. | Not published here |

The category guard is for supported Purchase category changes. It does not authorize changing amounts, payees, dates, payment details, other lines, or arbitrary accounting records. Each real accounting change still requires a reviewed, specific approval.

## Work needed before publishing the code

1. Review the local changes and remove machine-specific paths, credentials, tokens, customer data, financial reports, and one-off transaction scripts.
2. Port the production authentication, token-store override, tool allowlist, and narrow category-update implementation with their focused tests.
3. Run the repository build and test suite, including negative tests for stale snapshots and attempts to change protected fields.
4. Document setup with placeholder values only. Keep production credentials and token files outside Git and restrict access to their owner.
5. Validate reads and guarded writes in an isolated QuickBooks sandbox before enabling a production mutation. Review each production batch and verify the result against the source record and bank feed.

## Safety and scope

Cloning this fork today does **not** provide the local safeguards described above. Review the actual registered tools and configuration before connecting a production company. Do not commit client secrets, refresh tokens, bank statements, receipts, customer records, or live transaction details to this public repository.
