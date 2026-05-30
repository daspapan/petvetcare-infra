import { EnvironmentConfig } from '../config/environment';

export function stackName(config: EnvironmentConfig, stack: string): string {
  return `${config.appName}-${config.environment}-${stack}`;
}

export function tagKey(key: string): string {
  return key;
}

export function defaultTags(config: EnvironmentConfig): Record<string, string> {
  return {
    Application: config.appName,
    Environment: config.environment,
    Domain: config.domainName,
    ManagedBy: 'aws-cdk',
  };
}
