---
name: dataset-export
description: >-
  A checksummed bundle of episode data downloaded to the user's disk, made by an export job, for an external trainer or a partner. Use when the user wants to export, download, pull, package or hand over a dataset, chosen episodes or the episodes of a dataset version, follow, cancel or redo an export job, export timeseries channels as CSV or Parquet, export metadata, or get a training run's signed reproducibility record. Not for freezing training input used inside rFabric: that is `dataset-version`.
---

# Dataset export

The user ends up with one gzip tar archive on their disk that holds the sensor stream files of the episodes they chose and a manifest with a SHA-256 for every file. An ExportJob (`exj_...`) builds it on rFabric from a Dataset (`ds_...`), a list of Episodes (`ep_...`) or the episodes of a DatasetVersion (`dsv_...`); a converter (`cvtr_...`, the registered writer of the bundle) names how. The bundle is then downloaded in parts. Every export is recorded with who asked for it (`exportAuditId`). Three smaller exports follow the steps.

Apply `rfabric-basics` throughout: it defines what to tell the user at each moment and how to call rFabric.

## At a glance

| # | Step | Who | Operations | Wait |
| --- | --- | --- | --- | --- |
| 1 | Settle what leaves rFabric | user, agent reads | `datasets.list`, `datasets.get`, `episodes.list`, `dataset-versions.list` | the user's answer |
| 2 | Find the converter | agent | `format-registry.list-converters` | none |
| 3 | Preview the scope | agent | `export-jobs.resolve` | none |
| 4 | Create the export job | agent | `export-jobs.create` | none |
| 5 | Follow the job | agent | `export-jobs.get` | until `status` is `completed` |
| 6 | Download the bundle | agent with a shell; otherwise user, in a terminal | `export-jobs.download-parts` | the download |
| 7 | Verify and hand over | same as step 6, in the same sitting | `export-jobs.get` | none |

## Before you start

- **Permissions**

  | Work | Permission | Built-in roles |
  | --- | --- | --- |
  | Create an export job, export timeseries | `export:create` | `operator`, `admin`, `owner` |
  | List, read, preview, download | `export:read` | `operator`, `admin`, `owner` |
  | Cancel a job | `export:cancel` | `operator`, `admin`, `owner` |
  | Export metadata | `metadata:export` | `operator`, `admin`, `owner` |
  | Read a reproducibility record | `training:read` | `member`, `operator`, `admin`, `owner` |

- **Needs**:
  - Episodes whose sensor streams are `ready` (`dataset-upload`, `dataset-import`, `recording-conversion`).
  - A selection, when not everything goes: `episode-search` for a query, `dataset-curation` for a curated dataset, `dataset-version` for a frozen version. A candidate composition is exported as the episodes of the version frozen from it.
  - On the computer that downloads: a terminal with `bash`, `curl`, `tar` and `jq` (macOS or Linux; on Windows use WSL), the `rfabric` CLI signed in to the same organization, and free disk space for the archive and its unpacked files.
- **Ask the user**

  | Input | Why | How to find it or default |
  | --- | --- | --- |
  | What to export | The scope (Decisions) | Offer the datasets of `datasets.list` and the versions of `dataset-versions.list` |
  | Who receives the data | The export copies data out of rFabric and is recorded under the user's name | No default; ask when it is not the user |

## Decisions

| Option | Choose when | Consequence |
| --- | --- | --- |
| Whole datasets (recommended when the dataset is the unit) | Everything in one or more datasets should go | `scope.datasetIds`; a curated dataset exports its members |
| Chosen episodes | Only episodes matching a filter or query | Collect ids with `episodes.list` (every page), send `scope.episodeIds` |
| Episodes of a DatasetVersion | The recipient should get exactly what a version froze | `episodes.list` with `datasetVersionId`, then `scope.episodeIds`. The bundle holds those episodes' stream files, not the version's prepared training files |

## Steps

### 1. Settle what leaves rFabric

Read the size before you ask: `datasets.get` (`episodeCount`, `totalDuration` in seconds) or `episodes.list` with the filter and `count: true`.

Tell the user, before they confirm:

- the episode count;
- what the bundle is: every sensor stream file of those episodes as rFabric stores it (cameras included), one file per stream, plus a manifest. It is as large as the recordings, and it is rFabric's own layout, not a dataset in another format;
- that the file is downloaded to a computer of theirs. Training on rFabric needs no export: it reads a DatasetVersion (`dataset-version`, `training-run`).

```text
episodes/<episodeId>/streams/<sensorStreamId>.<fileType>   one file per sensor stream
manifest.json                                              formatVersion, exportFormat, createdAt, scope,
                                                           files[] {relativePath, byteSize, sha256Hex}, manifestChecksum
FORMAT.md                                                  a short format note
```

Done when the user confirmed the scope and the recipient.

### 2. Find the converter

`format-registry.list-converters` with `workspaceId`, `direction` `export` and `formatKey` `archive_bundle`. Take the converter with `enabled: true`: its `name` and `version` are the job's `converterName` and `converterVersion`.

Done when you hold one enabled converter's name and version.

### 3. Preview the scope

`export-jobs.resolve` with `workspaceId` and `scope` (a POST that creates nothing). The response's `resolvedScope.episodeIds` is exactly what a job would export. Show the count; when it differs from step 1, stop and find out why.

Use only `datasetIds` and `episodeIds` in `scope`. Done when the count matches what the user confirmed.

### 4. Create the export job

Say before the call: this copies the data of N episodes into a bundle on rFabric and records the export under the user's name.

```json
{
  "workspaceId": "wks_...",
  "exportFormat": "archive_bundle",
  "deliveryTarget": "download",
  "converterName": "<name from step 2>",
  "converterVersion": "<version from step 2>",
  "scope": { "datasetIds": ["ds_..."] }
}
```

`export-jobs.create` returns the job with `status` `queued` and its `exportAuditId`. Keep `exportFormat` `archive_bundle` and `deliveryTarget` `download`: this workflow ends in a download. Done when you hold the `exj_...` id.

### 5. Follow the job

Poll `export-jobs.get` every 15 seconds. `status` goes `queued` -> `running` -> `completed`, or ends `failed` or `cancelled`. While it runs, `progress` carries `phase` (`materializing`, then `writing`), `filesWritten`, `bytesWritten` and `currentPath`; `throughputBytesPerHour` gives the pace. Report a phase change and a rough share done, not every poll.

- **Cancel**: `export-jobs.cancel` (optional `reason`) stops a `queued` or `running` job. It cannot be resumed.
- **Redo**: a `failed` or `cancelled` job never runs again. Read `errorMessage`, fix the cause (Problems), and create a job with the same body. The old job stays in `export-jobs.list` as the record of the attempt; `export-jobs.transitions` shows who moved it and when.
- **Find earlier jobs**: `export-jobs.list` with `workspaceId`, `deliveryTarget` `download` and `status`. The bundle of a `completed` job is downloaded from step 6. Jobs whose `deliveryTarget` is `dataset_version` belong to a version freeze (`dataset-version`), not to this workflow.

Done when `status` is `completed`: the job then has `byteSize`, `partSizeBytes`, `partCount` and `manifestChecksum`.

### 6. Download the bundle

The bundle comes down in parts, each through a link that works for 15 minutes and must be fetched with its exact byte range. `rfabric_download` refuses these links, so the rFabric agent's transfer tools cannot download the bundle: the download goes through a shell. One script does the whole download (recommended: one approval for all parts): it asks rFabric for the links through the `rfabric` CLI, a few parts at a time, and appends each part to one file.

Write this script as `download_export.sh` in your working directory:

```bash
#!/usr/bin/env bash
# Downloads the bundle of a completed export job into export.tar.gz, part by part.
# Usage: bash download_export.sh <export-job-id>
# Needs the rfabric CLI (signed in), curl and jq. Safe to run again: it continues where it stopped.
set -euo pipefail
job="$1"
sign() {
  rfabric api post "/api/export-jobs/$job/download-parts" --no-validate --output json \
    --data "{\"fromPartNumber\":$1,\"toPartNumber\":$2}"
}
first=$(sign 1 1)
total=$(echo "$first" | jq -r .byteSize)
part_size=$(echo "$first" | jq -r .partSizeBytes)
count=$(echo "$first" | jq -r .partCount)
touch export.tar.gz
have=$(($(wc -c < export.tar.gz)))
if [ "$have" -ne "$total" ] && [ $((have % part_size)) -ne 0 ]; then
  echo "export.tar.gz holds $have bytes, which is not a whole number of parts. Delete it and run again." >&2
  exit 1
fi
from=$((have / part_size + 1))
while [ "$from" -le "$count" ] && [ "$have" -lt "$total" ]; do
  to=$((from + 19)); if [ "$to" -gt "$count" ]; then to=$count; fi
  sign "$from" "$to" | jq -r '.parts[] | [.partNumber, .byteOffset, .byteLength, .url] | @tsv' |
    while IFS=$'\t' read -r number offset length url; do
      curl --fail --silent --show-error -H "Range: bytes=${offset}-$((offset + length - 1))" -o export.part "$url"
      cat export.part >> export.tar.gz
      echo "part $number of $count"
    done
  from=$((to + 1))
done
rm -f export.part
have=$(($(wc -c < export.tar.gz)))
echo "export.tar.gz: $have of $total bytes"
[ "$have" -eq "$total" ]
```

Write the script of step 7 as `verify_export.sh` beside it. Then:

- **With a shell**: run `bash download_export.sh <export job id> && bash verify_export.sh` yourself after the user approves. Say the size first and report when it is done. This includes the rFabric agent started with `rfabric agent --with-shell`: its approved command runs as the user, with the user's signed-in CLI.
- **Without a shell**: hand over both scripts in one block. Fill in the folder, the job id and the size (`byteSize` in GB or MB).

```text
Your turn - a terminal on your computer; it runs unattended for as long as <size> takes on your connection
Why: the bundle is fetched in parts through your signed-in rfabric CLI and curl, which need a terminal; I have none here. I wrote two scripts: one downloads the bundle, one checks it.
Who: you, on a computer where the rfabric CLI is signed in to <organization> (rfabric auth status shows it).

1. Open a terminal in <working directory>.
2. Run:

   bash download_export.sh <export job id> && bash verify_export.sh

Creates: export.tar.gz (<size>) and the unpacked folder export/ in that directory. Nothing changes on rFabric.
Undo: delete export.tar.gz and export/.
If it stops: run the same command again. It continues where it stopped.
Bring back: the last three lines it prints, or the error message if it stops twice in the same place.
Then I: compare the checksum with the export job and tell you whether the bundle is complete.
```

The last three lines are the archive's size, the number of files that match their checksum, and the `manifestChecksum`.

A shell without the `rfabric` CLI: sign the parts with `export-jobs.download-parts` (`fromPartNumber`, `toPartNumber`, at most 100 per call; the response body carries `parts`, each with `partNumber`, `byteOffset`, `byteLength` and `url`, beside `byteSize`, `partSizeBytes` and `partCount`). After the user approves, fetch each part in order with `curl --fail -H "Range: bytes=<byteOffset>-<byteOffset + byteLength - 1>"` and append it to the archive; sign the next parts when the links are older than 15 minutes. Then run `verify_export.sh`. This path needs many more approvals than the script: prefer the script wherever the CLI is installed.

When you cannot write files, show the user both scripts to save under those names in an empty folder.

Done when the file's size equals the job's `byteSize`.

### 7. Verify and hand over

`verify_export.sh` unpacks the archive and checks every file against the manifest:

```bash
#!/usr/bin/env bash
# Unpacks export.tar.gz into export/ and checks every file against the manifest.
set -euo pipefail
mkdir -p export
tar -xzf export.tar.gz -C export
cd export
if command -v sha256sum >/dev/null 2>&1; then sum="sha256sum"; else sum="shasum -a 256"; fi
jq -r '.files[] | "\(.sha256Hex)  \(.relativePath)"' manifest.json | $sum -c --quiet -
echo "files that match their checksum: $(jq '.files | length' manifest.json)"
echo "manifestChecksum: $(jq -r .manifestChecksum manifest.json)"
```

It stops with the name of each file that does not match. The bundle is good when the size line shows the full size, the file count is printed, and `manifestChecksum` equals the job's (`export-jobs.get`).

Then report: job id, episodes, size, `manifestChecksum`, where the archive and the unpacked `export/` folder are, and `exportAuditId` as the record of who exported what. Passing the bundle on (to a partner, into a bucket of their own) is the user's step with their own tools; the manifest lets the recipient run the same check.

## Other exports

| Goal | Operation | What the user must know |
| --- | --- | --- |
| Channels of one sensor stream as a table | `sensor-streams.timeseries-export` | `channels` (comma-separated keys from the stream's `channels` in `sensor-streams.get`), `startNs` and `endNs` in nanoseconds (`startNs` below `endNs`, `endNs` excluded), `format` `csv` or `parquet`. Rows are `episodeId,sensorStreamId,channelKey,tNs,value` at full resolution. The data comes back in the response, so keep the window small; each call is audited. An unknown channel key yields no rows |
| Metadata of entities as a portable bundle | `metadata.export` | `kind` inside `selection`: `ids` with the entity ids, or `workspace`; `format` `json` or `ndjson`. Names, attributes, tags, relationships and lineage only, no recordings. Select by `ids`: a whole workspace returns through the conversation |
| Proof of what a training run consumed | `training-runs.reproducibility-export` | `document` (config, `datasetVersionIds`, code version, trainer image, the CI build that launched it, base model, seed, environment, metrics, `consumedManifestChecksum`) and a `signature`. Keep both exactly as returned: any edit breaks the signature, which only rFabric can check. `training-runs.list` with `datasetVersionId` finds the runs of a version |

## Problems

| Signal | What it means | Do |
| --- | --- | --- |
| 422 `VALIDATION_ERROR`, "Export converter ... is not registered or enabled" | Wrong `converterName` or `converterVersion`, or the converter is disabled or imports only | Step 2 |
| 422, "Export scope resolves to zero episodes" | The scope names no `datasetIds` or `episodeIds` that hold episodes | Fix the scope and preview again (step 3) |
| 403 `FORBIDDEN`, "Inaccessible episodes: ..." | Some episodes belong to another workspace | Remove them, or export them from their own workspace |
| 422 with `field` in `details` naming `deliveryTarget` or the scope's `datasetVersionId` | Those values are reserved for a version freeze | Use `deliveryTarget` `download` and `scope.episodeIds` (Decisions) |
| Job `failed`, `errorMessage` naming a file with no valid sha256 | A source file was registered without a checksum; a bundle only takes files it can vouch for | Tell the user which file; export without those episodes, or import that data again (`dataset-import`) and redo |
| Job `failed`, `errorMessage` "does not exist" or "does not match its sha256" | A source file is gone or changed in storage | For data linked from the user's bucket, check the bucket and its `storage-connection`; otherwise report the job id and the file named |
| The script stops with 409, "download requires completed" | The job is not `completed` | Step 5 |
| The script stops with 401, 403 or 404 from `rfabric` | The CLI on that computer is not signed in, or is signed in to another organization than the export job's | `rfabric auth status` shows who is signed in and to which organization; `rfabric auth login` signs in. Then the same command again |
| `curl` stops with error 403 | A link expired on a slow connection | Run the same command again: it signs fresh links and continues |
| The script stops with "not a whole number of parts" | The archive was cut off inside a part | Delete the archive and run the command again |
| `verify_export.sh` names a file as FAILED | The download is damaged | Delete the archive and `export/`, run the command again; a second failure on the same file: report the job id and the file |
| `jq: command not found` | `jq` is not installed | macOS: `brew install jq`; Debian or Ubuntu: `sudo apt-get install jq`; then the same command again |
| 409 `CONFLICT` on cancel, "is already ..." | The job already ended | Read it; nothing to cancel |
| 400 `BAD_REQUEST`, "timeseries_window_invalid" | `startNs` is not below `endNs` | Fix the window |
| 403 naming `export`, `metadata` or `training` | The user's role lacks the permission (table above) | Name the permission; `member-access` finds why it is missing and what can add it |

## Done when

- [ ] `export-jobs.get` shows `status` `completed` with the scope the user confirmed.
- [ ] The downloaded file's size equals `byteSize`.
- [ ] The manifest's `manifestChecksum` equals the job's and every file passed its SHA-256 check.
- [ ] The user knows where the archive is and that `exportAuditId` records the export.

## Next

- `external-training-run`: record on rFabric the training done elsewhere on this data.
- `dataset-version`: freeze the same episodes so training on rFabric can pin them.
- `audit-review`: see who exported what, and when.

## The rfabric CLI

They need a signed-in `rfabric` CLI; `--output json` prints what the API returned. The download itself is step 6.

| Step | CLI |
| --- | --- |
| Create the job | `rfabric api post /api/export-jobs --data '<json>'` |
| List and read jobs | `rfabric export-job ls`, `rfabric export-job get <job-id>` |
| Wait for a job | `rfabric export-job wait <job-id> --wait-timeout 30m` |
| Cancel a job | `rfabric export-job cancel <job-id>` |
| Timeseries to a file | `rfabric sensor-stream timeseries export <sensor-stream-id> --channels <keys> --start-ns <ns> --end-ns <ns> --format parquet --output <file>` |
| Metadata to a file | `rfabric metadata export --ids <ids> --format ndjson --output <file>` |
| Reproducibility record | `rfabric training-run reproducibility-export <training-run-id>` |
