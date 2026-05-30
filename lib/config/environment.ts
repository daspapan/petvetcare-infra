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

export interface EnvironmentConfig {
  readonly appName: string;
  readonly domainName: string;
  readonly apiSubdomain: string;
  readonly cdnSubdomain: string;
  readonly environment: DeploymentEnvironment;
  readonly hostedZoneId?: string;
  readonly cognito: CognitoConfig;
  readonly aurora: AuroraConfig;
  readonly cors: CorsConfig;
}

function optionalEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

function parseList(value: string | undefined, fallback: string[]): string[] {
  if (!value) {
    return fallback;
  }
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

export function loadEnvironmentConfig(): EnvironmentConfig {
  const environment = (process.env.CDK_ENV ?? 'dev') as DeploymentEnvironment;
  const domainName = 'petvetcare.app';
  const webAppOrigin = optionalEnv('WEB_APP_ORIGIN') ?? `https://app.${domainName}`;

  return {
    appName: 'petvetcare',
    domainName,
    apiSubdomain: 'api',
    cdnSubdomain: 'cdn',
    environment,
    hostedZoneId: optionalEnv('HOSTED_ZONE_ID'),
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
  };
}

export function resourceName(config: EnvironmentConfig, suffix: string): string {
  return `${config.appName}-${config.environment}-${suffix}`;
}
