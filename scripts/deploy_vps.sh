#!/bin/bash
# Deploy via SSH usando expect (sem sshpass)
SSH_HOST=177.7.47.139
SSH_USER=root
SSH_PORT=2222
SSH_PASS='dsknkn288209.###jJJ'
REMOTE_DIR=/root/minestation/app_production

expect -c "
  set timeout 180
  spawn ssh -o StrictHostKeyChecking=no -p $SSH_PORT $SSH_USER@$SSH_HOST
  expect {
    \"password:\" { send \"$SSH_PASS\r\" }
    \"assword:\" { send \"$SSH_PASS\r\" }
  }
  expect \"\\\$\"
  send \"cd $REMOTE_DIR && git pull origin main && docker compose build app && docker compose up -d --no-deps app && sleep 3 && docker compose logs --tail=25 app\r\"
  expect -timeout 180 \"\\\$\"
  send \"exit\r\"
  expect eof
" 2>&1
