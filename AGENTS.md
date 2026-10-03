# Antigravity Rules & Permissions Policy

## Read Commands Policy
- **Auto-Approve All Read Commands**: All read operations, file viewing, codebase searches, log reads, and non-destructive inspection tasks are automatically authorized without requesting user permission prompts.
- **Strict Exception for `.env` and Confidential Files**: Reading `.env` files (`.env`, `.env.local`, etc.), private keys, API secrets, or credential stores ALWAYS requires explicit user permission.
