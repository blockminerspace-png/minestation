#!/usr/bin/env python3
"""
SSH com palavra-passe via Paramiko (mais fiável que OpenSSH+pexpect quando há
caracteres especiais na senha ou o cliente tenta muitas chaves públicas).

Variáveis de ambiente: SSH_HOST, SSH_USER, SSH_PORT, SSH_PASSWORD
Argumentos: comando remoto (argv[1:] juntos com shlex.join, como o ssh_pexpect).
"""
import os
import shlex
import sys

try:
    import paramiko
except ImportError:
    sys.stderr.write("ssh_paramiko_cli: instale paramiko (pip install paramiko).\n")
    sys.exit(127)

HOST = os.environ.get("SSH_HOST", "")
USER = os.environ.get("SSH_USER", "root")
PORT = int(os.environ.get("SSH_PORT", "22") or "22")
PASSWORD = os.environ.get("SSH_PASSWORD", "")

if not HOST or not PASSWORD:
    sys.stderr.write("ssh_paramiko_cli: falta SSH_HOST ou SSH_PASSWORD.\n")
    sys.exit(1)

remote_argv = sys.argv[1:]
remote_cmd = shlex.join(remote_argv) if remote_argv else "true"

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
try:
    client.connect(
        HOST,
        port=PORT,
        username=USER,
        password=PASSWORD,
        allow_agent=False,
        look_for_keys=False,
        timeout=30,
        banner_timeout=30,
    )
    stdin, stdout, stderr = client.exec_command(remote_cmd, get_pty=False)
    stdin.close()
    out = stdout.read()
    err = stderr.read()
    exit_status = stdout.channel.recv_exit_status()
    sys.stdout.buffer.write(out)
    sys.stderr.buffer.write(err)
    sys.exit(exit_status)
finally:
    try:
        client.close()
    except Exception:
        pass
