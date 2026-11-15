# omp-wakatime

Sends [WakaTime](https://wakatime.com) / [Wakapi](https://wakapi.dev) heartbeats from [oh-my-pi (omp)](https://omp.sh) agent sessions.

Each heartbeat names the actual file the agent read or edited, so language, project, and branch are detected per file. The plugin string is `omp/<omp version> omp-wakatime/<version>`, which Wakapi turns into editor `omp` and the right operating system.

## Requirements

- `wakatime-cli` on `PATH`, or in `~/.wakatime/` (`$WAKATIME_HOME` if set) as `wakatime-cli` or `wakatime-cli-<os>-<arch>`. Editor plugins such as vim-wakatime install it there; on Nix it is `pkgs.wakatime-cli`. The extension does not download it.
- `api_key` (and `api_url` for Wakapi) in `~/.wakatime.cfg`:

```ini
[settings]
api_url = https://wakapi.example.com/api
api_key = your-api-key
```

## Install

```bash
omp plugin install github:kisepichu/omp-wakatime
```

Restart omp. Upgrade with `omp plugin upgrade omp-wakatime`.

## What gets sent

| omp activity | Heartbeat |
| --- | --- |
| `read` of a file | that file |
| `edit` | each edited file, `--write`, `--ai-line-changes` counted from the diff |
| `write` | the written file, `--write` |
| prompts and other tools (`bash`, `grep`, ...) | the last file touched in the same working directory |

Every heartbeat uses category `ai coding` and `--project-folder <cwd>`. Failed tool calls send nothing, and nothing is sent until the session has touched a file. Non-write heartbeats for the same file are sent at most once every 2 minutes. wakatime-cli runs detached, so heartbeats never delay tool calls, and it logs its own errors to `~/.wakatime/wakatime.log`.

wakatime-cli also parses AI transcripts on disk (omp's included) on each call, and adds what it finds as extra heartbeats. Among them are `OMP <session>` app heartbeats, which have no language, so Wakapi versions that count app heartbeats show them as language `Unknown`. Setting `sync_ai_disabled = true` in `~/.wakatime.cfg` stops that parsing, but wakatime-cli then also drops every `ai coding` heartbeat, this plugin's included.

## Development

```bash
bun install
bun test
bun run typecheck
omp -e ./src/extension.ts   # load the working copy for one session
```
