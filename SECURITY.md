# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in this project, please report it responsibly.

**Do NOT open a public GitHub issue for security vulnerabilities.**

Instead, please email: **jianmin.wei@outlook.com**

Include:
- Description of the vulnerability
- Steps to reproduce
- Impact assessment
- Suggested fix (if any)

## Response Timeline

- **Acknowledgment:** Within 48 hours
- **Initial assessment:** Within 7 days
- **Fix and disclosure:** Within 90 days

## Scope

This policy covers:
- The MCP Metadata Discovery server (`src/`)
- The admin UI (`src/ui/`)
- The mock ingestion API (`src/ingestion/mock-ingest-routes.ts`)
- Configuration handling (`config.json` parsing)

## Known Security Considerations

- **Credentials:** Database passwords are stored in `config.json`. Ensure this file has restricted permissions (e.g., `chmod 600`).
- **API access:** The REST API and MCP endpoints have no authentication by default. Deploy behind a reverse proxy with auth in production.
- **Error messages:** Connection errors are sanitized to prevent credential leakage in logs.
- **Rate limiting:** Built-in rate limiting is configured but should be tuned for your deployment.

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.x     | Yes       |
