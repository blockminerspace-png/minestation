#!/usr/bin/env python3
"""
SSH com palavra-passe via pexpect (quando `sshpass` não está disponível).
Variáveis de ambiente: SSH_HOST, SSH_USER, SSH_PORT, SSH_PASSWORD
Argumentos: pass-through para `ssh` após user@host (ex.: bash -lc '...').
"""
import os
import sys

import pexpect

HOST = os.environ.get("SSH_HOST", "")
USER = os.environ.get("SSH_USER", "root")
PORT = os.environ.get("SSH_PORT", "2222")
PASSWORD = os.environ.get("SSH_PASSWORD", "")

if not HOST or not PASSWORD:
    sys.stderr.write("ssh_pexpect: falta SSH_HOST ou SSH_PASSWORD no ambiente.\n")
    sys.exit(1)

opts = [
    "-p",
    PORT,
    "-o",
    "ConnectTimeout=25",
    "-o",
    "ServerAliveInterval=15",
    "-o",
    "StrictHostKeyChecking=accept-new",
]
remote_argv = sys.argv[1:]
cmd = ["ssh"] + opts + [f"{USER}@{HOST}"] + remote_argv

child = pexpect.spawn(cmd[0], cmd[1:], encoding="utf-8", timeout=120)
child.logfile_read = sys.stderr

# Primeira ligação pode pedir confirmação de host key.
while True:
    i = child.expect(
        [
            "(?i)password:",
            "(?i)continue connecting",
            pexpect.EOF,
        ],
        timeout=120,
    )
    if i == 0:
        child.sendline(PASSWORD)
        break
    if i == 1:
        child.sendline("yes")
        continue
    child.close(force=True)
    sys.exit(child.exitstatus if child.exitstatus is not None else 1)

# Aguarda fim do comando remoto (docker build pode demorar muito).
child.expect(pexpect.EOF, timeout=None)
child.close()
sys.exit(child.exitstatus if child.exitstatus is not None else 1)
