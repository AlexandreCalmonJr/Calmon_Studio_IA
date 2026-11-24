import crypto from 'node:crypto';

export interface FirebaseIdTokenClaims {
  sub: string;
  aud: string;
  iss: string;
  exp: number;
  iat: number;
  auth_time: number;
  email?: string;
  email_verified?: boolean;
  name?: string;
}

interface FirebaseSigningKeySet {
  keys: Record<string, string>;
  expiresAt: number;
}

let signingKeys: FirebaseSigningKeySet | null = null;

async function loadFirebaseSigningKeys(): Promise<Record<string, string>> {
  if (signingKeys && signingKeys.expiresAt > Date.now()) return signingKeys.keys;

  const response = await fetch(
    'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com',
    { headers: { Accept: 'application/json' } },
  );
  if (!response.ok) throw new Error('Não foi possível obter as chaves públicas do Firebase.');
  const keys = (await response.json()) as Record<string, string>;
  const cacheControl = response.headers.get('cache-control') || '';
  const maxAge = Number(cacheControl.match(/max-age=(\d+)/i)?.[1] || 300);
  signingKeys = {
    keys,
    expiresAt: Date.now() + Math.max(60, Math.min(maxAge, 3600)) * 1000,
  };
  return keys;
}

export async function verifyFirebaseIdToken(
  token: string,
  projectId: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<FirebaseIdTokenClaims> {
  const cleanToken = token.trim();
  if (!cleanToken || !projectId.trim()) {
    throw new Error('Token Firebase ou FIREBASE_PROJECT_ID não configurado.');
  }

  const parts = cleanToken.split('.');
  if (parts.length !== 3) throw new Error('Firebase ID Token malformado.');

  let header: { alg?: string; kid?: string };
  let claims: FirebaseIdTokenClaims;
  try {
    header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    throw new Error('Firebase ID Token malformado.');
  }

  if (header.alg !== 'RS256' || !header.kid) {
    throw new Error('Algoritmo ou chave do Firebase ID Token inválidos.');
  }

  const keys = await loadFirebaseSigningKeys();
  const certificate = keys[header.kid];
  if (!certificate) throw new Error('Chave de assinatura Firebase desconhecida.');

  const validSignature = crypto.verify(
    'RSA-SHA256',
    Buffer.from(`${parts[0]}.${parts[1]}`),
    new crypto.X509Certificate(certificate).publicKey,
    Buffer.from(parts[2], 'base64url'),
  );
  if (!validSignature) throw new Error('Assinatura do Firebase ID Token inválida.');

  const expectedIssuer = `https://securetoken.google.com/${projectId}`;
  if (claims.aud !== projectId || claims.iss !== expectedIssuer) {
    throw new Error('O Firebase ID Token pertence a outro projeto.');
  }
  if (
    !claims.sub ||
    claims.sub.length > 128 ||
    !Number.isFinite(claims.exp) ||
    !Number.isFinite(claims.iat) ||
    !Number.isFinite(claims.auth_time) ||
    claims.exp <= nowSeconds ||
    claims.iat > nowSeconds + 300 ||
    claims.auth_time > nowSeconds + 300
  ) {
    throw new Error('Firebase ID Token expirado ou com declarações inválidas.');
  }

  return claims;
}
