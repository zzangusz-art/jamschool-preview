// 손님 IP — 어드민 로그인 잠금·결제 요청 제한·방문 집계가 같이 쓴다
//   길: 손님 → Cloudflare → Railway 엣지 → 이 서버(tools/serve.mjs)
//   - X-Forwarded-For 첫 값은 요청하는 쪽이 마음대로 넣을 수 있어 쓰지 않는다(시도마다 바꾸면 로그인 잠금을 피할 수 있었음).
//   - Railway 엣지가 넣는 X-Real-IP(없으면 X-Forwarded-For 마지막 값) = 바로 앞에서 접속한 주소. 보통 Cloudflare 서버다.
//   - 그 주소가 Cloudflare 대역일 때만 Cloudflare 가 덮어써 주는 CF-Connecting-IP 를 손님 IP 로 믿는다.
//     Railway 주소로 바로 들어와 CF-Connecting-IP 를 꾸민 요청은 접속 주소 그대로 본다.
//   Cloudflare 대역: https://www.cloudflare.com/ips-v4 · ips-v6 (2026-11-10 확인). 바뀌면 여기만 고친다.
import net from 'node:net';

const CF = {
  ipv4: ['173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22', '141.101.64.0/18', '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20',
    '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13', '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22'],
  ipv6: ['2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32', '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32'],
};
const BL = new net.BlockList();
for (const [type, list] of Object.entries(CF)) for (const c of list) { const [a, p] = c.split('/'); BL.addSubnet(a, +p, type); }

const clean = v => String(v || '').split(',')[0].trim().replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/, '');
export function isCloudflare(ip) {
  const t = net.isIP(ip);
  return t ? BL.check(ip, t === 4 ? 'ipv4' : 'ipv6') : false;
}
export function clientIp(req) {
  const h = req.headers || {};
  const xff = String(h['x-forwarded-for'] || '').split(',').map(s => s.trim()).filter(Boolean);
  const edge = clean(h['x-real-ip']) || clean(xff[xff.length - 1]) || clean(req.socket && req.socket.remoteAddress);
  const cf = clean(h['cf-connecting-ip']);
  return cf && net.isIP(cf) && isCloudflare(edge) ? cf : edge;
}
