# Optional Laya GPU API (separate deployment)

This service is a Python/CUDA process for an already provisioned GPU host. It is not the Node.js System One client, is not installed by the consumer npm package, and must not be used as a fallback for Node client operations.

## Runtime requirements

- Python 3.11 or newer on the GPU host only.
- The Laya `serve` and `fast` extras, FastAPI/httpx, and uvicorn as provided by the existing GPU deployment environment.
- A supported NVIDIA/CUDA runtime and weights provisioned by that deployment; this repository change does not download models or prove hardware execution.
- `LAYA_API_KEY` set in the service environment. Never place it in a client log or metrics file.

## Start

From the repository root, preserve the existing entry point and flags:

```sh
python3 mcp/laya_batch_server.py --host 127.0.0.1 --port 8000 --models multilingual --batch-size 8
```

`--stock` explicitly selects the existing non-fast mode. Without `--stock`, startup requires CUDA and calls strict acceleration; there is no silent CPU fallback. `--models` remains a comma-separated allowlist and `--batch-size` is bounded by the service contract.

The API retains bearer authentication, `/health`, `/v1/systemone`, and the true-batch `/v1/systemone/batch` route. Python request/answer validation is isolated in `integrations/laya-gpu/contracts.py`; the consumer-side Node client does not import or execute it.
