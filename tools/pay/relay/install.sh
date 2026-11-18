#!/usr/bin/env bash
# 잠스쿨 씨드 중계 서버 설치(우분투, Oracle Cloud 서울 무료 서버) — seed-relay.py 와 같은 폴더에서
#   sudo bash install.sh <이 서버 공인 IP>
# 하는 일: 전용 계정 seedrelay · /opt/seed-relay/seed-relay.py · /etc/seed-relay/{env,cert.pem,key.pem}(자체 서명, IP 이름표)
#          · systemd 서비스 seed-relay(재부팅·오류 때 자동 재시작) · 방화벽 8443 열기
# 다시 실행해도 된다(키·인증서는 이미 있으면 그대로 둔다). 끝나면 연결값(주소·키·인증서)을 출력한다.
set -euo pipefail
IP="${1:?공인 IP 를 넣어 주세요: sudo bash install.sh 1.2.3.4}"
PORT="${RELAY_PORT:-8443}"
HERE="$(cd "$(dirname "$0")" && pwd)"

id seedrelay >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin seedrelay
install -d -m 755 /opt/seed-relay
install -m 644 "$HERE/seed-relay.py" /opt/seed-relay/seed-relay.py
install -d -m 750 -o root -g seedrelay /etc/seed-relay

if [ ! -f /etc/seed-relay/env ]; then
  umask 077
  echo "RELAY_KEY=$(openssl rand -hex 32)" > /etc/seed-relay/env
  echo "RELAY_PORT=$PORT" >> /etc/seed-relay/env
fi
if [ ! -f /etc/seed-relay/cert.pem ] || ! openssl x509 -in /etc/seed-relay/cert.pem -noout -ext subjectAltName 2>/dev/null | grep -q "IP Address:$IP"; then
  openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -days 3650 \
    -subj "/CN=jamschool-seed-relay" -addext "subjectAltName=IP:$IP" \
    -keyout /etc/seed-relay/key.pem -out /etc/seed-relay/cert.pem 2>/dev/null
fi
chown root:seedrelay /etc/seed-relay/env /etc/seed-relay/key.pem /etc/seed-relay/cert.pem
chmod 640 /etc/seed-relay/env /etc/seed-relay/key.pem
chmod 644 /etc/seed-relay/cert.pem

cat > /etc/systemd/system/seed-relay.service <<UNIT
[Unit]
Description=Jamschool SeedPayments relay (approval/netCancel/cancel)
After=network-online.target
Wants=network-online.target

[Service]
User=seedrelay
Group=seedrelay
EnvironmentFile=/etc/seed-relay/env
ExecStart=/usr/bin/python3 /opt/seed-relay/seed-relay.py
Restart=always
RestartSec=3
AmbientCapabilities=
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadOnlyPaths=/etc/seed-relay /opt/seed-relay
MemoryMax=200M

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now seed-relay
systemctl restart seed-relay

# Oracle 우분투 이미지는 iptables 가 22번 말고는 막아 둔다 → 8443 허용(REJECT 줄보다 앞에), 재부팅 뒤에도 유지
if ! iptables -C INPUT -p tcp --dport "$PORT" -m state --state NEW -j ACCEPT 2>/dev/null; then
  iptables -I INPUT 5 -p tcp --dport "$PORT" -m state --state NEW -j ACCEPT
fi
if command -v netfilter-persistent >/dev/null 2>&1; then netfilter-persistent save >/dev/null 2>&1 || true; fi

sleep 2
systemctl is-active --quiet seed-relay && echo "seed-relay 실행 중 (:$PORT)" || { journalctl -u seed-relay -n 20 --no-pager; exit 1; }
KEY=$(sed -n 's/^RELAY_KEY=//p' /etc/seed-relay/env)
echo "---- 상태 ----"
curl -sk -H "X-Relay-Key: $KEY" "https://127.0.0.1:$PORT/health" || true
echo
echo "---- Railway 연결값(이 세 줄을 Railway 변수로) ----"
echo "SEEDPAY_RELAY_URL=https://$IP:$PORT"
echo "SEEDPAY_RELAY_KEY=$KEY"
echo "SEEDPAY_RELAY_CA=$(base64 -w0 /etc/seed-relay/cert.pem)"
