# File storage and Nextcloud

Chat files and recordings are stored behind one `FileStorage` interface. MongoDB GridFS is
always available. An organization can also keep its files in its own Nextcloud, set up from
**Admin → Integrations → Files & storage → Nextcloud**. Nothing is configured through env.

## Settings

| Field             | Notes                                                                        |
| ----------------- | ---------------------------------------------------------------------------- |
| Nextcloud address | e.g. `https://cloud.example.com`                                             |
| User name         | The Nextcloud account that owns the files (a dedicated service user is best) |
| App password      | Settings → Security → Devices & sessions. Encrypted at rest, never returned  |
| Folder            | Default `SampConnect`; created if missing, one subfolder per tenant          |
| Mode              | `test` (default) or `live`                                                   |

**Test connection** writes a small file, reads it back, deletes it, and reports how many files
have been copied or stored so far.

Platform operators can set a platform-wide Nextcloud that every tenant without its own
settings inherits.

## Modes

Every upload is written to GridFS first, so size and checksum checks always run the same way.
Once a file is complete:

- **Off:** it stays in GridFS. Nextcloud is never called.
- **Test mode:** it stays in GridFS and is copied to Nextcloud in the background. Downloads are
  always served from GridFS, so a Nextcloud outage or a wrong password cannot break chat. Each
  copy's outcome (`copied` or `failed`, with the reason) is recorded on the attachment.
- **Live:** it is copied to Nextcloud, then removed from GridFS, and downloads stream from
  Nextcloud (including byte ranges for audio and video seeking). If Nextcloud cannot be
  reached, the file stays in GridFS, the upload still succeeds, and the failure is recorded.

Files remember where they live (`nc:` keys are in Nextcloud), so switching modes or turning the
integration off never strands an existing file. Files already in Nextcloud keep using the
saved credentials even after the integration is turned off.

## Layout in Nextcloud

```
<folder>/<tenantId>/<attachmentId>
```

File names are attachment ids. The original names, types, sizes, checksums and access rules stay
in Connect, and downloads always go through Connect's signed links.

## Planned

- Moving files that are already in GridFS into Nextcloud (today only new files move).
- Sharing links and opening files inside Nextcloud.

## Files screen

`GET /v1/files?q=&kind=documents|images|media|other&in=&from=&recordings=true&before=&limit=` lists
files shared in conversations the caller can open (members, plus public channels in their
workspace), newest first, with a `nextBefore` cursor. Each item carries `kind`, the `messageId` it
was sent in and `storage` (`connect` or `nextcloud`). Unsent uploads, deleted files and recordings
(unless `recordings=true`) are left out. Downloads use the usual signed URL.

The web Files screen refetches when a message with files arrives on the device and on reconnect.
Offline it shows the last synced list merged with files in messages cached on the device.
