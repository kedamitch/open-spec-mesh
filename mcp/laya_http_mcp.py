#!/usr/bin/env python3
"""STDIO MCP plus a no-MCP CLI for reusable System One decisions over Laya or Jev."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
MANAGED_SITE = HERE.parent/'.open-spec-mesh-tools/laya/python'
if MANAGED_SITE.is_dir():
    sys.path.insert(0, str(MANAGED_SITE))
sys.path.insert(0, str(HERE))
from laya_contracts import list_templates, encode, config
from laya_runtime import Runtime, enabled, fallback

runtime = Runtime()


def create_server():
    # SDK v2 is the installed baseline. Keep the isolated SDK v1 smoke useful too.
    try:
        from mcp.server.mcpserver import MCPServer
    except ImportError:
        from mcp.server.fastmcp import FastMCP as MCPServer
    server = MCPServer('laya-decisions')

    @server.tool(name='laya_status')
    def status() -> str:
        """Explicit troubleshooting only. Uses Laya /health or Jev /v1/models; neither proves inference quality."""
        return encode(runtime.status()).decode()

    @server.tool(name='laya_templates')
    def templates() -> str:
        """List locally available versioned decisions and required fields; no model/network call."""
        if not enabled():
            return encode(fallback('disabled')).decode()
        try:
            return encode({'templates': list_templates()}).decode()
        except (ValueError, OSError):
            return encode(fallback('invalid_template')).decode()

    @server.tool(name='laya_decide')
    def decide(decision: str, items: list[dict], context: dict | None = None, model: str = 'auto') -> str:
        """Reuse one named judgment over 1-16 inputs. Do not rewrite questions each time.

        decision: execution-mode@1 or delegation@1 (or an operator-installed custom template).
        items: [{id: unique string, state: {request: original request, ...}}].
        context: shared existing facts; item.state overrides matching context fields.
        delegation@1 needs current_role and available_roles; execution_mode defaults to quick.
        Do not summarize long context solely to invoke this tool. Prefer direct judgment for
        obvious/one-off work. Returns per-ID recommendations or fallback; partial keeps valid IDs.
        No agent spawning, approvals, model changes or acceptance. Quick / SDD remain advisory routing choices.
        Laya inference uses /v1/systemone/batch. Jev uses the official /v1/systemone endpoint
        once per distinct state. On fallback continue the original actor's workflow.
        """
        return encode(runtime.run(decision, items, context, model)).decode()

    @server.tool(name='laya_predict')
    def predict(state: dict, questions: dict, model: str = 'auto') -> str:
        """Prototype a NEW reusable judgment, not the default for every decision.

        questions={id:{type:'choice'|'score'|'noul',instructions:string,criteria:...}}.
        choice criteria map <=20 labels to descriptions; score uses ordered descriptions;
        noul omits criteria or uses true/false descriptions. No text generation. Validate on
        representative data then store a versioned JSON template for repeated execution.
        auto uses the selected provider default: LAYA_MODEL/multilingual or
        TYPESAFE_DEFAULT_MODEL/jev-latest. Fallback means the current actor continues.
        """
        return encode(runtime.predict(state, questions, model)).decode()

    return server


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, help='JSON {decision,items,context?,model?}; run once without MCP SDK')
    args = parser.parse_args()
    if args.input:
        try:
            if args.input.stat().st_size > 128*1024:
                raise ValueError('input too large')
            body = json.loads(args.input.read_text())
            result = runtime.run(**body)
        except (OSError, TypeError, ValueError):
            result = fallback('invalid_input_file')
        print(encode(result).decode())
        return
    create_server().run()


if __name__ == '__main__':
    main()
