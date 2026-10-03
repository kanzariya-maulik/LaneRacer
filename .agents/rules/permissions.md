---
trigger: always_on
description: Auto-approve all read tool commands except .env files and confidential data.
---

# Antigravity CLI Permissions Directive

## Read Commands Auto-Approval
- **Auto-Approve Read Operations**: All read commands (`view_file`, directory listings, file searches, code analysis, non-mutating shell inspection commands) MUST be executed automatically without asking the user for permission.
- **Exceptions (Strict Manual Confirmation Required)**:
  1. Any `.env` file (including `.env`, `.env.local`, `.env.*`).
  2. Confidential key files, API credentials, secrets, or private keys (`*.pem`, `*.key`, `id_rsa`).
