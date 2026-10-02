import { CompactSign, compactVerify, importX509 } from 'npm:jose@5.10.0';
import { verifyAppleCertificateChain, verifyStoreKitJws } from './storekit.ts';
import { createPurchaseHandler } from '../verify-and-apply-purchase/index.ts';
import { createSyncHandler } from '../sync-app-store-subscription/index.ts';
import { createNotificationHandler } from '../apple-server-notifications/index.ts';
import fixtures from './fixtures/apple-storekit.json' with { type: 'json' };

await import('npm:reflect-metadata');
const { X509Certificate, X509CertificateGenerator, BasicConstraintsExtension,
  KeyUsagesExtension, KeyUsageFlags, Extension } = await import('npm:@peculiar/x509@2.0.0');

const effectiveDate = new Date(1_761_962_975_000);
const cert = (name: keyof typeof fixtures) => String(fixtures[name]);
const pem = (base64: string) => `-----BEGIN CERTIFICATE-----\n${base64}\n-----END CERTIFICATE-----`;
async function pin(root: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new X509Certificate(root).rawData);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

Deno.test('StoreKit verifier accepts the authentic Apple signing chain at its signed date', async () => {
  const root = cert('REAL_APPLE_ROOT_BASE64_ENCODED');
  await verifyAppleCertificateChain([
    cert('REAL_APPLE_SIGNING_CERTIFICATE_BASE64_ENCODED'),
    cert('REAL_APPLE_INTERMEDIATE_BASE64_ENCODED'), root,
  ], await pin(root), effectiveDate);
});

Deno.test('StoreKit verifier accepts official transaction and notification JWS fixtures', async () => {
  for (const signed of [fixtures.transactionInfo, fixtures.testNotification]) {
    const header = JSON.parse(atob(signed.split('.')[0])) as { x5c: string[] };
    const result = await verifyStoreKitJws(signed, { appleRootCertSha256: await pin(header.x5c[2]) });
    if (!result.ok) throw new Error(result.error);
  }
});

Deno.test('StoreKit verifier rejects valid-signed wrong-role chains before any admin query or mutation', async () => {
  const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const create = async (subject: string, issuer: string, ca: boolean, oid: string) =>
    await X509CertificateGenerator.create({
      subject, issuer, publicKey: keys.publicKey, signingKey: keys.privateKey,
      signingAlgorithm: { name: 'ECDSA', hash: 'SHA-256' },
      notBefore: new Date('2025-01-01'), notAfter: new Date('2030-01-01'),
      extensions: [new BasicConstraintsExtension(ca, ca ? 1 : undefined, true),
        new KeyUsagesExtension(ca ? KeyUsageFlags.keyCertSign : KeyUsageFlags.digitalSignature, true),
        new Extension(oid, false, new Uint8Array([5, 0]).buffer)],
    });
  const root = (await create('CN=root', 'CN=root', true, '1.2.3')).toString('base64');
  const intermediate = (await create('CN=intermediate', 'CN=root', true, '1.2.840.113635.100.6.2.1')).toString('base64');
  const wrongIntermediate = (await create('CN=intermediate', 'CN=root', true, '1.2.840.113635.100.6.2.2')).toString('base64');
  const leaf = (await create('CN=leaf', 'CN=intermediate', false, '1.2.840.113635.100.6.11.1')).toString('base64');
  const wrongLeaf = (await create('CN=leaf', 'CN=intermediate', false, '1.2.840.113635.100.6.11.2')).toString('base64');
  const rootPin = await pin(root);
  const key = keys.privateKey;
  const envValues: Record<string, string> = {
    APPLE_BUNDLE_ID: 'app.hither.mobile', APPLE_STORE_ENVIRONMENT: 'Sandbox',
    PREMIUM_PRODUCT_IDS: 'monthly,annual', PREMIUM_SUBSCRIPTION_GROUP_ID: 'group',
    APPLE_ROOT_CERT_SHA256: rootPin, SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service',
  };
  const dependencies = {
    env: (name: string) => envValues[name],
    createUser: () => ({ auth: { getUser: async () => ({
      data: { user: { id: 'user', is_anonymous: false } }, error: null,
    }) } }),
    createAdmin: () => { throw new Error('untrusted signer reached admin'); },
  };
  for (const chain of [
    [wrongLeaf, intermediate, root], [leaf, wrongIntermediate, root],
  ]) {
    // A valid PKIX path and JWS signature must not authorize the wrong signer role.
    const [leaf, intermediate, anchor] = chain.map((value) => new X509Certificate(value));
    if (!await leaf.verify({ publicKey: intermediate.publicKey, signatureOnly: true }) ||
        !await intermediate.verify({ publicKey: anchor.publicKey, signatureOnly: true })) {
      throw new Error('wrong-role fixture must have a valid certificate chain');
    }
    const signed = await new CompactSign(new TextEncoder().encode(JSON.stringify({
      signedDate: effectiveDate.getTime(), bundleId: 'app.hither.mobile', environment: 'Sandbox',
    }))).setProtectedHeader({ alg: 'ES256', x5c: chain }).sign(key);
    await compactVerify(signed, await importX509(pem(chain[0]), 'ES256'));
    const result = await verifyStoreKitJws(signed, { appleRootCertSha256: rootPin });
    if (result.ok) throw new Error('accepted a non-StoreKit signer');
    for (const handler of [
      createPurchaseHandler(dependencies), createSyncHandler(dependencies),
      createNotificationHandler(dependencies),
    ]) {
      const response = await handler(new Request('https://example.test', {
        method: 'POST', headers: { Authorization: 'Bearer user-jwt', 'Content-Type': 'application/json' },
        body: JSON.stringify({ signed_transaction: signed, signedPayload: signed }),
      }));
      if (response.status !== 422) throw new Error(`expected signer rejection, got ${response.status}`);
    }
  }
});

Deno.test('StoreKit chain rejects Apple official wrong-role certificate fixtures', async () => {
  const root = cert('ROOT_CA_BASE64_ENCODED');
  for (const chain of [
    [cert('LEAF_CERT_INVALID_OID_BASE64_ENCODED'), cert('INTERMEDIATE_CA_BASE64_ENCODED'), root],
    [cert('LEAF_CERT_FOR_INTERMEDIATE_CA_INVALID_OID_BASE64_ENCODED'), cert('INTERMEDIATE_CA_INVALID_OID_BASE64_ENCODED'), root],
  ]) {
    let rejected = false;
    try { await verifyAppleCertificateChain(chain, await pin(root), effectiveDate); } catch { rejected = true; }
    if (!rejected) throw new Error('accepted Apple wrong-role fixture');
  }
});

Deno.test('StoreKit chain rejects expired, reordered, truncated and foreign-root certificates', async () => {
  const root = cert('REAL_APPLE_ROOT_BASE64_ENCODED');
  const leaf = cert('REAL_APPLE_SIGNING_CERTIFICATE_BASE64_ENCODED');
  const intermediate = cert('REAL_APPLE_INTERMEDIATE_BASE64_ENCODED');
  for (const [chain, date, rootPin] of [
    [[leaf, intermediate, root], new Date('2040-01-01'), await pin(root)],
    [[intermediate, leaf, root], effectiveDate, await pin(root)],
    [[leaf, root], effectiveDate, await pin(root)],
    [[leaf, intermediate, root], effectiveDate, await pin(cert('ROOT_CA_BASE64_ENCODED'))],
  ] as const) {
    let rejected = false;
    try { await verifyAppleCertificateChain([...chain], rootPin, date); } catch { rejected = true; }
    if (!rejected) throw new Error('accepted an invalid certificate path');
  }
});
