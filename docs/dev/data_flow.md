# Data flow

How a dataset moves from the browser, through the API, and back out as an
enriched download. For the frontend side see [frontend flow](frontend_flow.md);
for request and response details see [file pipeline routes](file_routes.md).

## Overview

```
Browser (app)                      API (api)                      Disk / DB
-------------                      ---------                      ---------
choose file / type address
  |
  |-- POST /upload --------------> save file to session dir ----> <session>/data_<ts>.<ext>
  |<- sessionId, tempPath
  |
  |-- GET /address-fields -------> read file, detect columns
  |<- candidate column labels
  |
  |   (runs automatically when a field is detected)
  |-- POST /files/geocode -------> geocode each address --------> <session>/geocode_data_<ts>.csv
  |<- counts, preview, tempPath     (US Census geocoder)
  |
  |   (user picks ACS columns)
  |-- POST /files/acs -----------> query ACS per block group ---> PostgreSQL acs schema
  |<- counts, preview, tempPath                                    <session>/acs_data_<ts>.csv
  |
  |   (user picks geo and/or ACS)
  |-- POST /files/enrich --------> join sidecars onto original -> <session>/enriched_data_<ts>.<ext>
  |<- filename, added columns
  |
  |-- GET /download-file --------> stream the enriched file
```

The frontend calls everything under `/api`. Nginx (Docker) and the Vite dev
server both proxy `/api/*` to the API on port `9876` with the prefix removed.

## Sessions

Each upload gets a new UUID session directory under `UPLOAD_TEMP_DIR`
(`/tmp/enroll-dash` by default). Every later request passes the `sessionId` and
can only read or write files inside that directory. A session holds:

| File | Written by | Contents |
| --- | --- | --- |
| `data_<ts>.<ext>` | `/upload` | The original file, untouched |
| `geocode_data_<ts>.csv` | `/files/geocode` | Geocoder sidecar |
| `acs_data_<ts>.csv` | `/files/acs` | ACS sidecar |
| `enriched_data_<ts>.<ext>` | `/files/enrich` | Final output, same format as the upload |

Re-running a step overwrites its file. Sessions older than
`UPLOAD_SESSION_TTL_MS` (24 hours by default) are deleted by an hourly cleanup in
`api/src/main.ts`.

## Sidecars

The geocode and ACS steps don't modify the uploaded file. Each writes a
**sidecar** CSV keyed by `_row` (the zero-based row index in the original
dataset), so steps can run and re-run independently, and the final enrich step
joins only what the user asks for.

- **Geocode sidecar** (`api/src/dataset/sidecars.ts`, `geoSidecar`): `_row`,
  `_address`, then `matchedAddress`, `latitude`, `longitude`, `blockGeoid`,
  `state`, `county`, `tract`, `blkgrp`.
- **ACS sidecar** (`acsSidecar`): reads the geocode sidecar rather than the
  original file, queries each unique GEOID once
  (`api/src/dataset/acsDataset.ts`), and writes `_row`, `_address`, and one
  column per selected ACS column, labeled like `B02001 B02001001`.

Columns starting with `_` are dropped when sidecars are merged. Because sidecars
round-trip through CSV, `indexSidecar` (`api/src/utils/fileHelpers.ts`) turns
blank cells back into `null` and numeric strings back into numbers, but keeps
GEOIDs and other code columns as text so leading zeros survive.

## Enrich

`enrichFile` (`api/src/dataset/enrichFile.ts`) reloads the original upload,
then appends the geocode columns, ACS columns, or both, matching rows by `_row`.
With `join: 'inner'` it drops rows the geocoder didn't match; the default
`left` keeps every row. The output is saved in the upload's format, then
downloaded by the browser through `/download-file`.

## Limits and cancellation

Every `/files/*` step runs under `withDeadline` (`GEOCODE_DEADLINE_MS`, 60s by
default) and is aborted if the client disconnects. Row, column, size, and
concurrency limits come from `api/src/utils/fileLimits.ts`.

Generated with Claude Code
