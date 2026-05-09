#!/usr/bin/env python3
import subprocess
import sys
import time

HOST = "177.7.47.139"
PORT = "2222"
USER = "root"
PASS = "dsknkn288209.###jJJ"
REMOTE_DIR = "/root/minestation/app_production"

CMD = (
    f"cd {REMOTE_DIR} && "
    "git pull origin main && "
    "docker compose build app && "
    "docker compose up -d --no-deps app && "
    "sleep 4 && "
    "docker compose logs --tail=30 app"
)

import pty, os, select, termios, tty

def deploy():
    master, slave = pty.openpty()
    proc = subprocess.Popen(
        ["ssh", "-o", "StrictHostKeyChecking=no", "-p", PORT, f"{USER}@{HOST}", CMD],
        stdin=slave, stdout=slave, stderr=slave,
        close_fds=True
    )
    os.close(slave)

    buf = b""
    password_sent = False
    
    while True:
        try:
            r, _, _ = select.select([master], [], [], 0.5)
        except Exception:
            break
        if r:
            try:
                data = os.read(master, 4096)
            except OSError:
                break
            buf += data
            sys.stdout.buffer.write(data)
            sys.stdout.flush()
            if not password_sent and (b"password:" in buf.lower() or b"assword:" in buf.lower()):
                time.sleep(0.3)
                os.write(master, (PASS + "\n").encode())
                password_sent = True
                buf = b""
        if proc.poll() is not None:
            # drain
            try:
                data = os.read(master, 4096)
                sys.stdout.buffer.write(data)
                sys.stdout.flush()
            except OSError:
                pass
            break

    os.close(master)
    proc.wait()
    print(f"\n\n=== SSH exited with code {proc.returncode} ===")

deploy()
