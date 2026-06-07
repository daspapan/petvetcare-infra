import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import * as path from 'path';
import { EnvironmentConfig, resourceName } from '../config/environment';
import { defaultTags, stackName } from '../utils/naming';

export interface ComputeStackProps extends cdk.StackProps {
  readonly config: EnvironmentConfig;
  // Direct CDK references from auth-stack (no Fn.importValue -- avoids circular export lock).
  // Cognito trigger Lambdas live in auth-stack so there is no auth<->compute cross-stack ARN.
  readonly userPoolId: string;
  readonly userPoolArn: string;
  readonly webClientId: string;
  readonly hostedUiDomain: string;
  // From database-stack
  readonly otpTable: dynamodb.ITable;
  readonly databaseSecret: secretsmanager.ISecret;
  readonly dbEndpoint: string;
  readonly dbPort: string;
  readonly databaseName: string;
  // From messaging-stack
  readonly sesFromEmail: string;
}

export class ComputeStack extends cdk.Stack {
  // Auth API Lambdas wired into api-stack routes
  public readonly initiateAuthFn: lambda.IFunction;
  public readonly verifyOtpFn: lambda.IFunction;
  public readonly refreshTokenFn: lambda.IFunction;
  public readonly signOutFn: lambda.IFunction;
  public readonly oauthCallbackFn: lambda.IFunction;

  constructor(scope: Construct, id: string, props: ComputeStackProps) {
    super(scope, id, props);

    const {
      config,
      userPoolId,
      userPoolArn,
      webClientId,
      hostedUiDomain,
      otpTable,
      databaseSecret,
      dbEndpoint,
      dbPort,
      databaseName,
      sesFromEmail,
    } = props;

    Object.entries(defaultTags(config)).forEach(([key, value]) => {
      cdk.Tags.of(this).add(key, value);
    });

    const commonEnv: Record<string, string> = {
      APP_ENV:                  config.environment,
      COGNITO_USER_POOL_ID:     userPoolId,
      COGNITO_WEB_CLIENT_ID:    webClientId,
      COGNITO_REGION:           this.region,
      COGNITO_HOSTED_UI_DOMAIN: hostedUiDomain,
      OTP_TABLE_NAME:           otpTable.tableName,
      OTP_SALT:                 process.env.OTP_SALT ?? 'petvetcare-otp-salt',
      SES_FROM_EMAIL:           sesFromEmail,
      DATABASE_SECRET_ARN:      databaseSecret.secretArn,
      DATABASE_HOST:            dbEndpoint,
      DATABASE_PROXY_ENDPOINT:  dbEndpoint,
      DATABASE_PORT:            dbPort,
      DATABASE_NAME:            databaseName,
      CORS_ORIGIN:              config.cors.webAppOrigin,
      GOOGLE_REDIRECT_URI:
        config.cognito.webCallbackUrls[0] ??
        `https://app.${config.environment}.${config.dns.domainName}/auth/callback`,
    };

    // All Lambdas run outside the VPC -- no vpc/securityGroups props needed.
    const fnDefaults: nodejs.NodejsFunctionProps = {
      runtime:    lambda.Runtime.NODEJS_20_X,
      memorySize: 512,
      timeout:    cdk.Duration.seconds(29),
      environment: commonEnv,
      bundling: {
        minify: true,
        sourceMap: true,
        target: 'node20',
        externalModules: [
          '@aws-sdk/client-secrets-manager',
          '@aws-sdk/client-dynamodb',
          '@aws-sdk/lib-dynamodb',
          '@aws-sdk/client-ses',
          '@aws-sdk/client-cognito-identity-provider',
        ],
        nodeModules: ['pg'],
      },
      logRetention: logs.RetentionDays.ONE_MONTH,
    };

    const makeFn = (id: string, entry: string, fnName: string): nodejs.NodejsFunction =>
      new nodejs.NodejsFunction(this, id, {
        ...fnDefaults,
        functionName: resourceName(config, fnName),
        entry: path.join(__dirname, entry),
      });

    // ── Auth API Lambdas ─────────────────────────────────────────────────────

    this.initiateAuthFn = makeFn('InitiateAuthFunction', '../../lambda/handlers/initiate-auth.ts', 'auth-initiate');
    this.initiateAuthFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['cognito-idp:InitiateAuth'],
      resources: [userPoolArn],
    }));

    this.verifyOtpFn = makeFn('VerifyOtpFunction', '../../lambda/handlers/verify-otp.ts', 'auth-verify-otp');
    this.verifyOtpFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['cognito-idp:RespondToAuthChallenge'],
      resources: [userPoolArn],
    }));

    this.refreshTokenFn = makeFn('RefreshTokenFunction', '../../lambda/handlers/refresh-token.ts', 'auth-refresh');
    this.refreshTokenFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['cognito-idp:InitiateAuth'],
      resources: [userPoolArn],
    }));

    this.signOutFn = makeFn('SignOutFunction', '../../lambda/handlers/sign-out.ts', 'auth-sign-out');
    this.signOutFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['cognito-idp:GlobalSignOut'],
      resources: [userPoolArn],
    }));

    this.oauthCallbackFn = makeFn('OauthCallbackFunction', '../../lambda/handlers/oauth-callback.ts', 'auth-oauth-callback');

    new cdk.CfnOutput(this, 'InitiateAuthFunctionArn', {
      value: this.initiateAuthFn.functionArn,
      exportName: `${stackName(config, 'compute')}:InitiateAuthFunctionArn`,
    });
  }
}
