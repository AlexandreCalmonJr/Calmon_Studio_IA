/**
 * Fase 3 + Prioridade 2 — Adaptador Plugável de Object Storage (Disco Local Confinado + S3 / MinIO / GCS SigV4 Real).
 *
 * Mantém o modo zero-setup gravando artefatos em disco local com confinamento contra path traversal
 * e checksum SHA-256, e quando `OBJECT_STORAGE_PROVIDER` + credenciais estão configurados,
 * executa PUT, GET, DELETE e HEAD reais assinados com AWS Signature V4 (HMAC-SHA256) compatível com
 * Amazon S3, MinIO Self-Hosted e Google Cloud Storage (S3 Interop).
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export type ObjectStorageDriverKind = 'local_confined' | 's3' | 'gcs' | 'minio';

export interface StoredObjectReceipt {
  driver: ObjectStorageDriverKind;
  storageKey: string;
  sizeBytes: number;
  sha256: string;
  mimeType: string;
  locationHint: string;
  remoteSynced?: boolean;
}

export interface StorageDiagnostics {
  driver: ObjectStorageDriverKind;
  mode_label: string;
  configured_provider: string;
  bucket: string | null;
  endpoint: string | null;
  region: string | null;
  base_dir: string | null;
  multi_replica_ready: boolean;
  remote_reachable: boolean | null;
  remote_synced_count: number;
  sigv4_enabled: boolean;
  status: 'ready' | 'configured_standby';
}

export interface ArtifactStorageAdapter {
  readonly driver: ObjectStorageDriverKind;
  putObject(params: {
    userId: string;
    runId: string;
    filename: string;
    content: Buffer | string;
    mimeType: string;
  }): Promise<StoredObjectReceipt>;
  getObject(storageKey: string): Promise<Buffer | null>;
  deleteObject(storageKey: string): Promise<boolean>;
  getDiagnostics(): StorageDiagnostics;
  getDiagnosticsAsync?(probeNetwork?: boolean): Promise<StorageDiagnostics>;
}

const BLOCKED_METADATA_HOSTS = new Set([
  '169.254.169.254',
  'metadata.google.internal',
  'metadata.goog',
]);

function sanitizeSegment(raw: string, fallback: string): string {
  const cleaned = String(raw || '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/\.{2,}/g, '_')
    .replace(/^[._-]+/, '')
    .slice(0, 72);
  return cleaned || fallback;
}

export function resolveSafeStoragePath(baseDir: string, relativeKey: string): string {
  if (!relativeKey || relativeKey.includes('\0')) {
    throw new Error('Chave de armazenamento inválida.');
  }
  const normalizedBase = path.resolve(baseDir);
  const baseWithSep = normalizedBase.endsWith(path.sep)
    ? normalizedBase
    : `${normalizedBase}${path.sep}`;
  const candidate = path.resolve(normalizedBase, relativeKey);
  if (!candidate.startsWith(baseWithSep)) {
    throw new Error('Acesso bloqueado: tentativa de escape fora do diretório de artefatos.');
  }
  return candidate;
}

export function validateStorageEndpoint(rawEndpoint: string): { ok: true; url: URL } | { ok: false; reason: string } {
  try {
    const parsed = new URL(rawEndpoint);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { ok: false, reason: 'Endpoint de Object Storage deve usar HTTP ou HTTPS.' };
    }
    const host = parsed.hostname.toLowerCase();
    if (BLOCKED_METADATA_HOSTS.has(host) || host.startsWith('169.254.')) {
      return { ok: false, reason: 'Endpoint de metadados de nuvem bloqueado por política de segurança.' };
    }
    return { ok: true, url: parsed };
  } catch {
    return { ok: false, reason: 'Endpoint de Object Storage inválido.' };
  }
}

function hmacSha256(key: Buffer | string, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest();
}

function sha256Hex(data: Buffer | string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function encodeRfc3986Path(rawPath: string): string {
  return rawPath
    .split('/')
    .map((seg) => encodeURIComponent(seg).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
    .join('/');
}

/** Gera cabeçalhos AWS Signature V4 (HMAC-SHA256) autênticos para S3 / MinIO / GCS S3 Interop. */
export function signAwsV4Request(params: {
  method: 'PUT' | 'GET' | 'DELETE' | 'HEAD';
  url: URL;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  payload: Buffer;
  contentType?: string;
  now?: Date;
}): Record<string, string> {
  const now = params.now || new Date();
  const isoBasic = now.toISOString().replace(/[:-]|\.\d{3}/g, ''); // YYYYMMDDTHHMMSSZ
  const dateStamp = isoBasic.slice(0, 8);
  const service = 's3';
  const payloadHash = sha256Hex(params.payload);

  const canonicalHeadersMap: Record<string, string> = {
    host: params.url.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': isoBasic,
  };
  if (params.contentType) {
    canonicalHeadersMap['content-type'] = params.contentType;
  }

  const sortedKeys = Object.keys(canonicalHeadersMap).sort();
  const canonicalHeaders = sortedKeys.map((k) => `${k}:${canonicalHeadersMap[k].trim()}\n`).join('');
  const signedHeaders = sortedKeys.join(';');

  const canonicalUri = encodeRfc3986Path(params.url.pathname || '/');
  const queryEntries = Array.from(params.url.searchParams.entries()).sort(([a], [b]) => a.localeCompare(b));
  const canonicalQuery = queryEntries
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');

  const canonicalRequest = [
    params.method,
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const credentialScope = `${dateStamp}/${params.region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', isoBasic, credentialScope, sha256Hex(canonicalRequest)].join('\n');

  const kDate = hmacSha256(`AWS4${params.secretAccessKey}`, dateStamp);
  const kRegion = hmacSha256(kDate, params.region);
  const kService = hmacSha256(kRegion, service);
  const kSigning = hmacSha256(kService, 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');

  const headers: Record<string, string> = {
    'x-amz-date': isoBasic,
    'x-amz-content-sha256': payloadHash,
    Authorization: `AWS4-HMAC-SHA256 Credential=${params.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
  if (params.contentType) {
    headers['Content-Type'] = params.contentType;
  }
  return headers;
}

export class LocalConfinedStorageAdapter implements ArtifactStorageAdapter {
  public readonly driver: ObjectStorageDriverKind = 'local_confined';
  public readonly baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = path.resolve(baseDir);
    fs.mkdirSync(this.baseDir, { recursive: true });
  }

  public async putObject(params: {
    userId: string;
    runId: string;
    filename: string;
    content: Buffer | string;
    mimeType: string;
  }): Promise<StoredObjectReceipt> {
    const userSeg = sanitizeSegment(params.userId, 'user');
    const runSeg = sanitizeSegment(params.runId, 'run');
    const fileSeg = sanitizeSegment(params.filename, 'artifact.txt');
    const storageKey = `${userSeg}/${runSeg}/${Date.now().toString(36)}_${fileSeg}`;
    const fullPath = resolveSafeStoragePath(this.baseDir, storageKey);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });

    const buf = Buffer.isBuffer(params.content)
      ? params.content
      : Buffer.from(String(params.content || ''), 'utf8');
    const sha256 = sha256Hex(buf);
    fs.writeFileSync(fullPath, buf);

    return {
      driver: this.driver,
      storageKey,
      sizeBytes: buf.byteLength,
      sha256,
      mimeType: params.mimeType || 'application/octet-stream',
      locationHint: `local://${storageKey}`,
      remoteSynced: false,
    };
  }

  public async getObject(storageKey: string): Promise<Buffer | null> {
    const fullPath = resolveSafeStoragePath(this.baseDir, storageKey);
    if (!fs.existsSync(fullPath)) return null;
    return fs.readFileSync(fullPath);
  }

  public async deleteObject(storageKey: string): Promise<boolean> {
    const fullPath = resolveSafeStoragePath(this.baseDir, storageKey);
    if (!fs.existsSync(fullPath)) return false;
    fs.rmSync(fullPath, { force: true });
    return true;
  }

  public getDiagnostics(): StorageDiagnostics {
    return {
      driver: 'local_confined',
      mode_label: 'Disco Local Confinado (SHA-256)',
      configured_provider: 'local',
      bucket: null,
      endpoint: null,
      region: null,
      base_dir: this.baseDir,
      multi_replica_ready: false,
      remote_reachable: null,
      remote_synced_count: 0,
      sigv4_enabled: false,
      status: 'ready',
    };
  }

  public async getDiagnosticsAsync(): Promise<StorageDiagnostics> {
    return this.getDiagnostics();
  }
}

export class S3CompatibleStorageAdapter implements ArtifactStorageAdapter {
  public readonly driver: ObjectStorageDriverKind;
  private readonly bucket: string;
  private readonly endpoint: string;
  private readonly region: string;
  private readonly accessKeyId: string;
  private readonly secretAccessKey: string;
  private readonly fallbackLocal: LocalConfinedStorageAdapter;
  private readonly hasCredentials: boolean;
  private readonly fetchImpl: typeof fetch;
  private remoteReachable: boolean | null = null;
  private remoteSyncedCount = 0;

  constructor(opts: {
    provider: 's3' | 'gcs' | 'minio';
    bucket: string;
    endpoint: string;
    region?: string;
    localCacheDir: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    fetchImpl?: typeof fetch;
  }) {
    this.driver = opts.provider;
    this.bucket = opts.bucket.trim();
    this.endpoint = opts.endpoint.trim().replace(/\/+$/, '');
    this.region = (opts.region || 'us-east-1').trim();
    this.accessKeyId = (opts.accessKeyId || '').trim();
    this.secretAccessKey = (opts.secretAccessKey || '').trim();
    this.hasCredentials = Boolean(this.accessKeyId && this.secretAccessKey);
    this.fallbackLocal = new LocalConfinedStorageAdapter(opts.localCacheDir);
    this.fetchImpl = opts.fetchImpl || fetch;
  }

  private buildObjectUrl(storageKey?: string): URL | null {
    if (!this.endpoint || !this.bucket) return null;
    const baseCheck = validateStorageEndpoint(this.endpoint);
    if (!baseCheck.ok) return null;
    const keyPath = storageKey ? `/${storageKey.replace(/^\/+/, '')}` : '';
    return new URL(`${this.endpoint}/${encodeURIComponent(this.bucket)}${keyPath}`);
  }

  public async probeBucket(): Promise<boolean> {
    if (!this.hasCredentials) {
      this.remoteReachable = false;
      return false;
    }
    const bucketUrl = this.buildObjectUrl();
    if (!bucketUrl) {
      this.remoteReachable = false;
      return false;
    }
    const headers = signAwsV4Request({
      method: 'HEAD',
      url: bucketUrl,
      region: this.region,
      accessKeyId: this.accessKeyId,
      secretAccessKey: this.secretAccessKey,
      payload: Buffer.alloc(0),
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2_500);
    try {
      const res = await this.fetchImpl(bucketUrl.toString(), {
        method: 'HEAD',
        headers,
        signal: controller.signal,
      });
      clearTimeout(timer);
      this.remoteReachable = res.ok;
      return res.ok;
    } catch {
      clearTimeout(timer);
      this.remoteReachable = false;
      return false;
    }
  }

  public async putObject(params: {
    userId: string;
    runId: string;
    filename: string;
    content: Buffer | string;
    mimeType: string;
  }): Promise<StoredObjectReceipt> {
    // Grava primeiro em cache local confinado (durabilidade imediata + SHA-256)
    const localReceipt = await this.fallbackLocal.putObject(params);
    let remoteSynced = false;

    if (this.hasCredentials) {
      const objUrl = this.buildObjectUrl(localReceipt.storageKey);
      if (objUrl) {
        const buf = Buffer.isBuffer(params.content)
          ? params.content
          : Buffer.from(String(params.content || ''), 'utf8');
        const headers = signAwsV4Request({
          method: 'PUT',
          url: objUrl,
          region: this.region,
          accessKeyId: this.accessKeyId,
          secretAccessKey: this.secretAccessKey,
          payload: buf,
          contentType: localReceipt.mimeType,
        });
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8_000);
        try {
          const res = await this.fetchImpl(objUrl.toString(), {
            method: 'PUT',
            headers,
            body: new Uint8Array(buf),
            signal: controller.signal,
          });
          clearTimeout(timer);
          if (res.ok) {
            remoteSynced = true;
            this.remoteReachable = true;
            this.remoteSyncedCount += 1;
          } else {
            this.remoteReachable = false;
          }
        } catch {
          clearTimeout(timer);
          this.remoteReachable = false;
        }
      }
    }

    return {
      ...localReceipt,
      driver: this.driver,
      locationHint: `${this.driver}://${this.bucket}/${localReceipt.storageKey}`,
      remoteSynced,
    };
  }

  public async getObject(storageKey: string): Promise<Buffer | null> {
    // Tenta cache local primeiro para latência mínima; se ausente (multi-réplica), busca via SigV4 GET remoto
    const cached = await this.fallbackLocal.getObject(storageKey);
    if (cached) return cached;

    if (this.hasCredentials) {
      const objUrl = this.buildObjectUrl(storageKey);
      if (objUrl) {
        const headers = signAwsV4Request({
          method: 'GET',
          url: objUrl,
          region: this.region,
          accessKeyId: this.accessKeyId,
          secretAccessKey: this.secretAccessKey,
          payload: Buffer.alloc(0),
        });
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8_000);
        try {
          const res = await this.fetchImpl(objUrl.toString(), {
            method: 'GET',
            headers,
            signal: controller.signal,
          });
          clearTimeout(timer);
          if (res.ok) {
            const arrBuf = await res.arrayBuffer();
            this.remoteReachable = true;
            return Buffer.from(arrBuf);
          }
        } catch {
          clearTimeout(timer);
          this.remoteReachable = false;
        }
      }
    }
    return null;
  }

  public async deleteObject(storageKey: string): Promise<boolean> {
    const localDeleted = await this.fallbackLocal.deleteObject(storageKey);
    let remoteDeleted = false;

    if (this.hasCredentials) {
      const objUrl = this.buildObjectUrl(storageKey);
      if (objUrl) {
        const headers = signAwsV4Request({
          method: 'DELETE',
          url: objUrl,
          region: this.region,
          accessKeyId: this.accessKeyId,
          secretAccessKey: this.secretAccessKey,
          payload: Buffer.alloc(0),
        });
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 6_000);
        try {
          const res = await this.fetchImpl(objUrl.toString(), {
            method: 'DELETE',
            headers,
            signal: controller.signal,
          });
          clearTimeout(timer);
          remoteDeleted = res.ok || res.status === 204;
        } catch {
          clearTimeout(timer);
        }
      }
    }
    return localDeleted || remoteDeleted;
  }

  public getDiagnostics(): StorageDiagnostics {
    const labelMap: Record<'s3' | 'gcs' | 'minio', string> = {
      s3: 'Amazon S3 (SigV4 Object Storage)',
      gcs: 'Google Cloud Storage (S3 SigV4 Interop)',
      minio: 'MinIO Self-Hosted (S3 SigV4)',
    };
    return {
      driver: this.driver,
      mode_label: labelMap[this.driver as 's3' | 'gcs' | 'minio'] || 'Object Storage S3 SigV4',
      configured_provider: this.driver,
      bucket: this.bucket,
      endpoint: this.endpoint || null,
      region: this.region,
      base_dir: this.fallbackLocal.baseDir,
      multi_replica_ready: this.hasCredentials,
      remote_reachable: this.remoteReachable,
      remote_synced_count: this.remoteSyncedCount,
      sigv4_enabled: this.hasCredentials,
      status: this.hasCredentials ? 'ready' : 'configured_standby',
    };
  }

  public async getDiagnosticsAsync(probeNetwork = false): Promise<StorageDiagnostics> {
    if (probeNetwork && this.hasCredentials) {
      await this.probeBucket();
    }
    return this.getDiagnostics();
  }
}

export function createArtifactStorageAdapter(
  dataDir: string,
  env: NodeJS.ProcessEnv = process.env
): ArtifactStorageAdapter {
  const artifactsDir = path.join(path.resolve(dataDir), 'artifacts');
  const provider = String(env.OBJECT_STORAGE_PROVIDER || '').trim().toLowerCase();
  const bucket = String(env.OBJECT_STORAGE_BUCKET || '').trim();
  const endpoint = String(env.OBJECT_STORAGE_ENDPOINT || '').trim();
  const region = String(env.OBJECT_STORAGE_REGION || 'us-east-1').trim();

  if ((provider === 's3' || provider === 'gcs' || provider === 'minio') && bucket) {
    return new S3CompatibleStorageAdapter({
      provider,
      bucket,
      endpoint,
      region,
      localCacheDir: artifactsDir,
      accessKeyId: env.OBJECT_STORAGE_ACCESS_KEY_ID,
      secretAccessKey: env.OBJECT_STORAGE_SECRET_ACCESS_KEY,
    });
  }

  return new LocalConfinedStorageAdapter(artifactsDir);
}
