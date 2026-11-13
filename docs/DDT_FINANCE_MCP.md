# DDT Finance Gateway MCP

The DDT Finance Gateway is a local-first, review-first accounting control plane for QuickBooks workflows. It can read a sandbox snapshot and stage financial evidence, but it does not expose a tool that posts an approved batch, pays a bill, or reconciles an account in QuickBooks.

## Available tools

| Tool | Ability |
| --- | --- |
| `list_financial_sources` | Shows configured direct-Intuit and local evidence sources without a paid CData dependency. |
| `pull_qbo_snapshot` | Saves a read-only sandbox company/account/purchase snapshot locally. |
| `ingest_statement` | Fingerprints and ingests a CSV statement into local staging. |
| `detect_duplicates` | Finds duplicate files and duplicate statement rows. |
| `match_transfers_and_payments` | Separates transfers, card payments, refunds, and duplicate imports before expense classification. |
| `link_payment_tags_to_qbo_ids` | Links high-confidence local payment tags to read-only sandbox QuickBooks IDs. |
| `classify_transactions` | Proposes categories for unmatched local rows using reviewed rules. |
| `stage_bill_scan_review` | Stages a reviewed mixed scan packet and keeps bills, card/bank statements, loans, and compliance notices distinct. |
| `record_owner_answer` | Records an owner decision in local control state. |
| `build_approval_batch` | Builds a local proposal for review; it does not apply it. |
| `reconciliation_status` | Reports evidence/control status and confirms that batch application is unavailable. |

## Mixed scan intake

`stage_bill_scan_review` is intentionally not an OCR guesser or payment tool. A caller supplies reviewed document facts and a disposition for each document in a PDF or image packet. The gateway:

- requires an absolute existing source path;
- hashes the source with SHA-256 and rejects the same scan a second time;
- stores only local, git-ignored review data;
- accepts only the final four account digits;
- records `quickBooksWritePerformed: false` and `paymentPerformed: false` on every review;
- distinguishes vendor/utility bills from card statements, bank statements, financing records, and compliance notices.

This avoids treating a loan disbursement as income, a credit-card payment as a second expense, or a compliance notice as an ordinary vendor bill.

## Durable Windows runtime

Run `node scripts/build-runtime.mjs` to compile the MCP into `%LOCALAPPDATA%\DDTFinanceForeman\qbo-mcp-dist`. The build links the repository dependency tree and copies non-sensitive classification templates beside the durable local data root. Local statements, scan reviews, audit logs, tokens, PDFs, and financial exports are ignored by Git.

The installed gateway can be launched with:

```powershell
node "$env:LOCALAPPDATA\DDTFinanceForeman\qbo-mcp-dist\bookkeeping\gateway\mcp-server.js"
```

All three QuickBooks mutation categories are forced off in the standalone gateway process. `apply_approved_batch` is deliberately absent from its MCP tool inventory.
