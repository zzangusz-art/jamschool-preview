#!/usr/bin/env python3
"""잠스쿨 씨드페이먼츠 한국 중계 서버 (jamschool.kr 결제 서버 → 이 서버 → 씨드 승인 API)

왜: 씨드페이먼츠 승인 서버(AWS 방화벽)가 해외 IP 요청을 403 으로 막는다. jamschool.kr 서버는 Railway 미국에 있어서
    카드 인증 뒤 승인·망취소·취소 요청이 막힌다. 이 프로그램을 한국 IP 서버(Oracle Cloud 서울 무료 서버)에서 돌려
    그 세 가지 요청만 씨드에 대신 전달한다.

하는 일(이것만 한다)
  POST /seed/<op>          op = approval | netCancel | cancel  → https://pay.seedpayments.co.kr/payment/v1/<op>
  POST /seed/test/<op>     씨드 테스트 서버(devpay)로
  GET  /health             이 서버 상태와 씨드 승인 주소가 이 서버를 받아 주는지(가짜 상점 demotest0m 로 확인)
  - 모든 요청은 X-Relay-Key 헤더가 설정값과 같아야 한다(다르면 403). 그 밖의 주소는 404.
  - 본문은 그대로 넘기고 씨드의 응답 코드·본문을 그대로 돌려준다. 본문은 기록하지 않는다.
  - HTTPS(자체 서명 인증서) — jamschool.kr 서버가 이 인증서를 고정(pin)해서 이 서버만 믿는다.

설정(/etc/seed-relay/env): RELAY_KEY, (선택) RELAY_PORT=8443, RELAY_CERT, RELAY_KEYFILE, RELAY_UPSTREAM(시험용)
의존성 없음: 우분투 기본 python3 표준 라이브러리만 쓴다.
"""
import hmac
import json
import os
import ssl
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

KEY = os.environ.get('RELAY_KEY', '')
PORT = int(os.environ.get('RELAY_PORT', '8443'))
CERT = os.environ.get('RELAY_CERT', '/etc/seed-relay/cert.pem')
KEYFILE = os.environ.get('RELAY_KEYFILE', '/etc/seed-relay/key.pem')
UPSTREAM = {
    'real': os.environ.get('RELAY_UPSTREAM', 'https://pay.seedpayments.co.kr'),
    'test': os.environ.get('RELAY_UPSTREAM_TEST', 'https://devpay.seedpayments.co.kr'),
}
OPS = {'approval', 'netCancel', 'cancel'}
MAX_BODY = 64 * 1024
TIMEOUT = 25
STARTED = time.time()
stats = {'ok': 0, 'fail': 0, 'last': ''}
lock = threading.Lock()


def log(msg):
    print(time.strftime('%Y-%m-%d %H:%M:%S'), msg, flush=True)


def forward(url, body, ctype):
    req = urllib.request.Request(url, data=body, method='POST', headers={'Content-Type': ctype, 'User-Agent': 'jamschool-seed-relay/1'})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            return r.status, r.read(), r.headers.get('Content-Type', 'application/json')
    except urllib.error.HTTPError as e:
        return e.code, e.read(), e.headers.get('Content-Type', 'text/plain')


_health = {'at': 0, 'data': None}


def health():
    if _health['data'] and time.time() - _health['at'] < 60:
        return _health['data']
    body = urllib.parse.urlencode({'nonce': 'probe', 'tid': 'demotest0m01012611180000000000', 'ediDate': time.strftime('%Y%m%d%H%M%S'), 'mid': 'demotest0m',
                                   'goodsAmt': '1000', 'mbsReserved': '', 'hashString': '0' * 64, 'payData': 'probe'}).encode()
    try:
        st, raw, _ = forward(UPSTREAM['real'] + '/payment/v1/approval', body, 'application/x-www-form-urlencoded; charset=utf-8')
        seed = {'status': st, 'body': raw[:120].decode('utf-8', 'replace')}
    except Exception as e:  # 통신 실패
        seed = {'status': 0, 'error': str(e)[:120]}
    data = {'ok': seed.get('status') == 200, 'seed': seed, 'uptime': int(time.time() - STARTED), 'stats': dict(stats), 'at': time.strftime('%Y-%m-%dT%H:%M:%S')}
    _health.update(at=time.time(), data=data)
    return data



class Handler(BaseHTTPRequestHandler):
    server_version = 'seed-relay'
    sys_version = ''

    def send(self, code, body, ctype='application/json; charset=utf-8'):
        if isinstance(body, (dict, list)):
            body = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def authed(self):
        got = self.headers.get('X-Relay-Key', '')
        return bool(KEY) and hmac.compare_digest(got.encode(), KEY.encode())

    def log_message(self, fmt, *args):  # 기본 접속 기록 끔(아래에서 필요한 것만 남김)
        pass

    def do_GET(self):
        if self.path.split('?')[0] != '/health':
            return self.send(404, {'error': 'not found'})
        if not self.authed():
            return self.send(403, {'error': 'forbidden'})
        return self.send(200, health())

    def do_POST(self):
        parts = self.path.split('?')[0].strip('/').split('/')
        env = 'real'
        if len(parts) == 3 and parts[0] == 'seed' and parts[1] == 'test':
            env, op = 'test', parts[2]
        elif len(parts) == 2 and parts[0] == 'seed':
            op = parts[1]
        else:
            return self.send(404, {'error': 'not found'})
        if op not in OPS:
            return self.send(404, {'error': 'not found'})
        if not self.authed():
            log(f'거절(키 불일치) {self.client_address[0]} {op}')
            return self.send(403, {'error': 'forbidden'})
        n = int(self.headers.get('Content-Length') or 0)
        if n <= 0 or n > MAX_BODY:
            return self.send(400, {'error': 'bad body'})
        ctype = self.headers.get('Content-Type', '')
        if not ctype.startswith('application/x-www-form-urlencoded'):
            return self.send(415, {'error': 'form only'})
        body = self.rfile.read(n)
        t = time.time()
        try:
            st, raw, rtype = forward(f"{UPSTREAM[env]}/payment/v1/{op}", body, ctype)
        except Exception as e:
            with lock:
                stats['fail'] += 1
                stats['last'] = f'{op} 통신 실패'
            log(f'{op} 통신 실패 {type(e).__name__}')
            return self.send(502, {'error': 'upstream unreachable'})
        with lock:
            stats['ok' if st == 200 else 'fail'] += 1
            stats['last'] = f'{op} {st}'
        log(f'{env} {op} → {st} ({int((time.time() - t) * 1000)}ms)')
        self.send_response(st)
        self.send_header('Content-Type', rtype or 'application/json')
        self.send_header('Content-Length', str(len(raw)))
        self.send_header('X-Upstream-Status', str(st))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(raw)


def main():
    if len(KEY) < 32:
        sys.exit('RELAY_KEY(32자 이상)를 /etc/seed-relay/env 에 넣어 주세요')
    srv = ThreadingHTTPServer(('0.0.0.0', PORT), Handler)
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.minimum_version = ssl.TLSVersion.TLSv1_2
    ctx.load_cert_chain(CERT, KEYFILE)
    srv.socket = ctx.wrap_socket(srv.socket, server_side=True)
    log(f'seed-relay 시작 :{PORT} → {UPSTREAM["real"]}')
    srv.serve_forever()


if __name__ == '__main__':
    main()
