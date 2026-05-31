export type DeploymentEnvironment = 'dev' | 'staging' | 'prod';

export interface CognitoConfig {
  readonly userPoolName: string;
  readonly webCallbackUrls: string[];
  readonly webLogoutUrls: string[];
  readonly mobileCallbackUrls: string[];
  readonly mobileLogoutUrls: string[];
  readonly googleClientId?: string;
  readonly googleClientSecret?: string;
  readonly appleClientId?: string;
  readonly appleTeamId?: string;
  readonly appleKeyId?: string;
  readonly applePrivateKey?: string;
}

export interface AuroraConfig {
  readonly minCapacity: number;
  readonly maxCapacity: number;
  readonly databaseName: string;
  readonly backupRetentionDays: number;
}

export interface CorsConfig {
  readonly webAppOrigin: string;
  readonly mobileAppOrigin: string;
  readonly allowHeaders: string[];
  readonly allowMethods: string[];
}

export interface CertificateConfig {
  /** ACM cert in us-east-1 — required for CloudFront */
  readonly cloudFrontCertificateArn: string;
  /** Regional ACM cert for API Gateway custom domain (same region as API stack) */
  readonly apiCertificateArn?: string;
}

export interface DnsConfig {
  /** Existing Route 53 hosted zone ID — never create a new zone */
  readonly hostedZoneId: string;
  readonly domainName: string;
  /** When false, DNS records must be configured externally */
  readonly createDnsRecords: boolean;
}

export interface EnvironmentConfig {
  readonly appName: string;
  readonly environment: DeploymentEnvironment;
  readonly dns: DnsConfig;
  readonly apiSubdomain: string;
  readonly publicAssetCdnDomain: string;
  readonly cognito: CognitoConfig;
  readonly aurora: AuroraConfig;
  readonly cors: CorsConfig;
  readonly certificates: CertificateConfig;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

function optionalEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value.trim() : undefined;
}

function parseList(value: string | undefined, fallback: string[]): string[] {
  if (!value) {
    return fallback;
  }
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function normalizeCertificateArn(arn: string): string {
  return arn.replace(/^arn\s+arn:/, 'arn:');
}

export function loadEnvironmentConfig(): EnvironmentConfig {
  const environment = (process.env.CDK_ENV ?? 'dev') as DeploymentEnvironment;
  const domainName = process.env.DOMAIN_NAME ?? 'petvetcare.app';
  const webAppOrigin =
    optionalEnv('WEB_APP_ORIGIN') ?? `https://app.${environment}.${domainName}`;

  const cloudFrontCertificateArn = normalizeCertificateArn(
    requireEnv('ACM_CERTIFICATE_ARN'),
  );

  return {
    appName: 'petvetcare',
    environment,
    dns: {
      hostedZoneId: requireEnv('HOSTED_ZONE_ID'),
      domainName,
      createDnsRecords: process.env.CREATE_DNS_RECORDS === 'true',
    },
    apiSubdomain: optionalEnv('API_SUBDOMAIN') ?? `api.${environment}`,
    publicAssetCdnDomain:
      optionalEnv('PUBLIC_ASSET_CDN_DOMAIN') ?? `cdn.${environment}.${domainName}`,
    cognito: {
      userPoolName: `petvetcare-${environment}-users`,
      webCallbackUrls: parseList(process.env.WEB_CALLBACK_URLS, [
        `${webAppOrigin}/auth/callback`,
        'http://localhost:3000/auth/callback',
      ]),
      webLogoutUrls: parseList(process.env.WEB_LOGOUT_URLS, [
        `${webAppOrigin}/auth/logout`,
        'http://localhost:3000/auth/logout',
      ]),
      mobileCallbackUrls: parseList(process.env.MOBILE_CALLBACK_URLS, [
        'petvetcare://auth/callback',
      ]),
      mobileLogoutUrls: parseList(process.env.MOBILE_LOGOUT_URLS, [
        'petvetcare://auth/logout',
      ]),
      googleClientId: optionalEnv('GOOGLE_CLIENT_ID'),
      googleClientSecret: optionalEnv('GOOGLE_CLIENT_SECRET'),
      appleClientId: optionalEnv('APPLE_CLIENT_ID'),
      appleTeamId: optionalEnv('APPLE_TEAM_ID'),
      appleKeyId: optionalEnv('APPLE_KEY_ID'),
      applePrivateKey: optionalEnv('APPLE_PRIVATE_KEY'),
    },
    aurora: {
      minCapacity: Number(process.env.AURORA_MIN_ACU ?? '0.5'),
      maxCapacity: Number(process.env.AURORA_MAX_ACU ?? '4'),
      databaseName: process.env.AURORA_DATABASE_NAME ?? 'petvetcare',
      backupRetentionDays: Number(process.env.AURORA_BACKUP_RETENTION_DAYS ?? '7'),
    },
    cors: {
      webAppOrigin,
      mobileAppOrigin: optionalEnv('MOBILE_APP_ORIGIN') ?? '*',
      allowHeaders: [
        'Authorization',
        'Content-Type',
        'X-Amz-Date',
        'X-Api-Key',
        'X-Amz-Security-Token',
        'X-Requested-With',
        'X-Client-Platform',
        'X-Client-Version',
      ],
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    },
    certificates: {
      cloudFrontCertificateArn,
      apiCertificateArn: optionalEnv('API_CERTIFICATE_ARN')
        ? normalizeCertificateArn(optionalEnv('API_CERTIFICATE_ARN')!)
        : undefined,
    },
  };
}

export function resourceName(config: EnvironmentConfig, suffix: string): string {
  return `${config.appName}-${config.environment}-${suffix}`;
}

export function apiDomainName(config: EnvironmentConfig): string {
  return `${config.apiSubdomain}.${config.dns.domainName}`;
}
