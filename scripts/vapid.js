// Derive a stable VAPID key pair from SESSION_SECRET, so no extra secret is needed.
// Prints shell-style lines: VAPID_PUBLIC_KEY=... and VAPID_PRIVATE_KEY=...
import crypto from 'node:crypto';
const secret = process.env.SESSION_SECRET;
if (!secret) { console.error('SESSION_SECRET missing'); process.exit(1); }
const b64url = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
for (let i = 0; i < 10; i++) {
  const d = crypto.createHmac('sha256', secret).update(`fair-whack-vapid-${i}`).digest();
  try {
    const ecdh = crypto.createECDH('prime256v1');
    ecdh.setPrivateKey(d);
    console.log(`VAPID_PUBLIC_KEY=${b64url(ecdh.getPublicKey())}`);
    console.log(`VAPID_PRIVATE_KEY=${b64url(d)}`);
    process.exit(0);
  } catch { /* out of range: try next */ }
}
process.exit(1);
