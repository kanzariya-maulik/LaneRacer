# Antigravity CLI Permissions & Safety Policy

## Tool & Command Execution Permissions

### 1. Read Commands Auto-Approval Rule
- **Auto-Approve Read Operations**: All read operations (including `view_file`, file searches, directory listings, web page fetches, log inspections, and non-destructive read commands) are pre-authorized and MUST proceed automatically without prompting the user for manual permission confirmation.
- **Zero Confirmation for Safe Reads**: The assistant and CLI execution engine should never pause or ask the user for confirmation when executing read commands for codebase source files, documentation, assets, unit tests, configuration templates, or system status lookups.

### 2. Mandatory Sensitive & Confidential File Protection
- **.env Files Exclusion**: Any read or access targeting `.env` files (e.g. `.env`, `.env.local`, `.env.development`, `.env.production`, `*.env*`) is strictly EXCLUDED from auto-approval. The agent MUST ask for explicit user permission before accessing or reading `.env` files.
- **Confidential Data & Keys Protection**: Files containing private keys (e.g., `*.pem`, `*.key`, `id_rsa`), authentication tokens, database passwords, API credentials, or marked confidential files are strictly EXCLUDED from auto-read approval and require user confirmation.

### 3. Write & Execution Safety
- Destructive modifications, file deletions, system parameter alterations, or untrusted external command executions continue to follow standard safety controls and explicit user review guidelines when required.
