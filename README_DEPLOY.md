# Mithai Dispatch Deployment

## Minimum Production Setup

1. Copy `.env.example` to `.env` and edit values.
2. Run behind HTTPS with Caddy, Nginx, or your cloud provider TLS proxy.
3. Start with Docker Compose:

```sh
docker compose up -d --build
```

4. Open the app over HTTPS and immediately change all default passwords from **Settings**.

Production startup refuses to run if the seeded default passwords are still active.

## Persistent Data

Use persistent volumes for:

- `DATA_DIR`: live JSON database and product master.
- `BACKUP_DIR`: automatic JSON snapshots.

For real financial use, copy backups off the server daily using your cloud backup tool, `rclone`, or a managed snapshot service.

## Render Free Warning

Render Free is fine for a demo link, but not for live business records with this file-based version:

- Free web services spin down after inactivity.
- The local filesystem is ephemeral, so JSON data and uploaded photos can be lost on redeploy, restart, or spin-down.
- Free web services do not support persistent disks.

Use Render Free only to preview the app. For real use, either:

- upgrade to a paid Render service with a persistent disk, or
- move storage to a durable database/object store before going live.

## Render Blueprint Demo

`render.yaml` is included for a quick Render Blueprint deploy. After deploying, check service logs for `initial-credentials.txt` location or open the service shell on a paid plan. On Render Free, shell access and persistent disks are not available, so this is demo-only.

## Security Notes

- Sessions use HttpOnly SameSite cookies.
- Passwords changed after this version use PBKDF2 hashing.
- Login throttling is enabled.
- Request body size is capped.
- CSV exports protect against spreadsheet formula injection.
- HTTPS is required in production.

## Healthcheck

`GET /api/health`

## Restore

Stop the app, replace `DATA_DIR/db.json` and `DATA_DIR/products.json` from a known-good backup, then restart.
