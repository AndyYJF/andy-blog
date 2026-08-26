#!/usr/bin/env python3
"""Read-only SSH helper. Password from env SSH_PASS only. Never writes on remote."""
from __future__ import annotations

import argparse
import os
import sys

import paramiko


def require_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        print(f"{name} env required", file=sys.stderr)
        raise SystemExit(2)
    return value


def require_ssh_target(host: str | None = None, user: str | None = None) -> tuple[str, str]:
    """Resolve host/user from explicit values or env. No insecure defaults."""
    resolved_host = host or os.environ.get("SSH_HOST")
    resolved_user = user or os.environ.get("SSH_USER")
    if not resolved_host:
        print("SSH_HOST env required", file=sys.stderr)
        raise SystemExit(2)
    if not resolved_user:
        print("SSH_USER env required", file=sys.stderr)
        raise SystemExit(2)
    return resolved_host, resolved_user


def _apply_host_key_policy(client: paramiko.SSHClient) -> None:
    client.load_system_host_keys()
    known_hosts = os.environ.get("SSH_KNOWN_HOSTS")
    if known_hosts:
        client.load_host_keys(known_hosts)
    client.set_missing_host_key_policy(paramiko.RejectPolicy())


def _lookup_known_keys(client: paramiko.SSHClient, name: str):
    """Look up host keys in system then user stores (same order as SSHClient.connect)."""
    for store in (client._system_host_keys, client._host_keys):
        entries = store.lookup(name)
        if entries is not None:
            return entries
    return None


def _verify_host_key(client: paramiko.SSHClient, host: str, port: int, transport: paramiko.Transport) -> None:
    """Verify remote host key the same way SSHClient.connect would."""
    server_key = transport.get_remote_server_key()
    keytype = server_key.get_name()
    # Prefer port-qualified name when non-default (matches OpenSSH / Paramiko).
    if port == 22:
        candidates = (host, f"[{host}]:22")
    else:
        candidates = (f"[{host}]:{port}", host)

    known = None
    matched_name = candidates[0]
    for name in candidates:
        entries = _lookup_known_keys(client, name)
        if entries is not None:
            known = entries
            matched_name = name
            break

    if known is None or keytype not in known:
        client.get_policy().missing_host_key(client, matched_name, server_key)
        return

    expected = known[keytype]
    if expected != server_key:
        raise paramiko.BadHostKeyException(matched_name, server_key, expected)


def connect(host: str, user: str, password: str, port: int = 22) -> paramiko.SSHClient:
    client = paramiko.SSHClient()
    _apply_host_key_policy(client)

    transport = paramiko.Transport((host, port))
    transport.start_client(timeout=30)
    _verify_host_key(client, host, port, transport)

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
    parser.add_argument("--host", default=None, help="SSH host (or set SSH_HOST)")
    parser.add_argument("--user", default=None, help="SSH user (or set SSH_USER)")
    parser.add_argument("--port", type=int, default=int(os.environ.get("SSH_PORT", "22")))
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    password = os.environ.get("SSH_PASS")
    if not password:
        print("SSH_PASS env required", file=sys.stderr)
        return 2
    if args.host is None and not os.environ.get("SSH_HOST"):
        print("SSH_HOST env required (or --host)", file=sys.stderr)
        return 2
    if args.user is None and not os.environ.get("SSH_USER"):
        print("SSH_USER env required (or --user)", file=sys.stderr)
        return 2
    host, user = require_ssh_target(args.host, args.user)
    cmd = " ".join(args.command).lstrip("-- ").strip()
    if not cmd:
        print("command required", file=sys.stderr)
        return 2

    client = connect(host, user, password, args.port)
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
