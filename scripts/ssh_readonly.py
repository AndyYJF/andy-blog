#!/usr/bin/env python3
"""Read-only SSH helper. Password from env SSH_PASS only. Never writes on remote."""
from __future__ import annotations

import argparse
import os
import sys

import paramiko


def connect(host: str, user: str, password: str, port: int = 22) -> paramiko.SSHClient:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    transport = paramiko.Transport((host, port))
    transport.connect()

    try:
        transport.auth_password(user, password)
    except paramiko.AuthenticationException:
        def handler(title, instructions, prompt_list):
            return [password for _ in prompt_list]

        transport.auth_interactive(user, handler)

    client._transport = transport
    return client


def run(client: paramiko.SSHClient, cmd: str, timeout: int = 120) -> tuple[int, str, str]:
    stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    code = stdout.channel.recv_exit_status()
    return code, out, err


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default=os.environ.get("SSH_HOST", "139.224.71.200"))
    parser.add_argument("--user", default=os.environ.get("SSH_USER", "root"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("SSH_PORT", "22")))
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    password = os.environ.get("SSH_PASS")
    if not password:
        print("SSH_PASS env required", file=sys.stderr)
        return 2
    cmd = " ".join(args.command).lstrip("-- ").strip()
    if not cmd:
        print("command required", file=sys.stderr)
        return 2

    client = connect(args.host, args.user, password, args.port)
    try:
        code, out, err = run(client, cmd)
        sys.stdout.write(out)
        if err:
            sys.stderr.write(err)
        return code
    finally:
        client.close()


if __name__ == "__main__":
    raise SystemExit(main())
