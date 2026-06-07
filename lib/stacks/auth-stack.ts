import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
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

export interface AuthStackProps extends cdk.StackProps {
  readonly config: EnvironmentConfig;
  // Trigger Lambda dependencies (from database-stack + messaging-stack)
  readonly otpTable: dynamodb.ITable;
  readonly databaseSecret: secretsmanager.ISecret;
  readonly dbEndpoint: string;
  readonly dbPort: string;
  readonly databaseName: string;
  readonly sesFromEmail: string;
}

export class AuthStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly webUserPoolClient: cognito.UserPoolClient;
  public readonly mobileUserPoolClient: cognito.UserPoolClient;
  public readonly userPoolDomain: cognito.UserPoolDomain;

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, props);

    const { config, otpTable, databaseSecret, dbEndpoint, dbPort, databaseName, sesFromEmail } = props;

    Object.entries(defaultTags(config)).forEach(([key, value]) => {
      cdk.Tags.of(this).add(key, value);
    });

    // ── User Pool ─────────────────────────────────────────────────────────────
    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: config.cognito.userPoolName,
      selfSignUpEnabled: true,
      signInAliases: { email: true, username: false },
      autoVerify: { email: true },
      standardAttributes: {
        email: { required: true, mutable: true },
        givenName: { required: false, mutable: true },
        familyName: { required: false, mutable: true },
      },
      customAttributes: {
        tenantId:        new cognito.StringAttribute({ minLen: 1, maxLen: 128, mutable: true }),
        tenantRole:      new cognito.StringAttribute({ minLen: 1, maxLen: 64,  mutable: true }),
        plan:            new cognito.StringAttribute({ minLen: 1, maxLen: 32,  mutable: true }),
        profileComplete: new cognito.StringAttribute({ minLen: 1, maxLen: 8,   mutable: true }),
      },
      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
        tempPasswordValidity: cdk.Duration.days(7),
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      mfa: cognito.Mfa.OPTIONAL,
      mfaSecondFactor: { sms: false, otp: true },
      removalPolicy: config.environment === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      email: cognito.UserPoolEmail.withSES({  
        sesRegion: cdk.Stack.of(this).region, 
        fromEmail: 'papan.das@jaljaivikbazaar.com' // # sesFromEmail 
      }),
    });

    // ── Google IdP ────────────────────────────────────────────────────────────
    if (config.cognito.googleClientId && config.cognito.googleClientSecret) {
      new cognito.UserPoolIdentityProviderGoogle(this, 'GoogleProvider', {
        userPool: this.userPool,
        clientId: config.cognito.googleClientId,
        clientSecretValue: cdk.SecretValue.unsafePlainText(config.cognito.googleClientSecret),
        scopes: ['openid', 'email', 'profile'],
        attributeMapping: {
          email:      cognito.ProviderAttribute.GOOGLE_EMAIL,
          givenName:  cognito.ProviderAttribute.GOOGLE_GIVEN_NAME,
          familyName: cognito.ProviderAttribute.GOOGLE_FAMILY_NAME,
        },
      });
    }

    // ── Apple IdP ─────────────────────────────────────────────────────────────
    if (config.cognito.appleClientId && config.cognito.appleTeamId &&
        config.cognito.appleKeyId  && config.cognito.applePrivateKey) {
      new cognito.UserPoolIdentityProviderApple(this, 'AppleProvider', {
        userPool: this.userPool,
        clientId:   config.cognito.appleClientId,
        teamId:     config.cognito.appleTeamId,
        keyId:      config.cognito.appleKeyId,
        privateKey: config.cognito.applePrivateKey,
        scopes: ['email', 'name'],
        attributeMapping: {
          email:      cognito.ProviderAttribute.APPLE_EMAIL,
          givenName:  cognito.ProviderAttribute.APPLE_FIRST_NAME,
          familyName: cognito.ProviderAttribute.APPLE_LAST_NAME,
        },
      });
    }

    const supportedIdentityProviders = [cognito.UserPoolClientIdentityProvider.COGNITO];
    if (config.cognito.googleClientId && config.cognito.googleClientSecret) {
      supportedIdentityProviders.push(cognito.UserPoolClientIdentityProvider.GOOGLE);
    }
    if (config.cognito.appleClientId && config.cognito.appleTeamId &&
        config.cognito.appleKeyId  && config.cognito.applePrivateKey) {
      supportedIdentityProviders.push(cognito.UserPoolClientIdentityProvider.APPLE);
    }

    const oAuthSettings: cognito.OAuthSettings = {
      flows: { authorizationCodeGrant: true, implicitCodeGrant: false },
      scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL, cognito.OAuthScope.PROFILE],
    };

    // ── App Clients ───────────────────────────────────────────────────────────
    this.webUserPoolClient = this.userPool.addClient('WebClient', {
      userPoolClientName: resourceName(config, 'web-client'),
      generateSecret: false,
      authFlows: { userSrp: true, userPassword: false, custom: true },
      supportedIdentityProviders,
      oAuth: {
        ...oAuthSettings,
        callbackUrls: config.cognito.webCallbackUrls,
        logoutUrls:   config.cognito.webLogoutUrls,
      },
      preventUserExistenceErrors: true,
      accessTokenValidity:  cdk.Duration.hours(1),
      idTokenValidity:      cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(30),
      enableTokenRevocation: true,
    });

    this.mobileUserPoolClient = this.userPool.addClient('MobileClient', {
      userPoolClientName: resourceName(config, 'mobile-client'),
      generateSecret: false,
      authFlows: { userSrp: true, userPassword: false, custom: true },
      supportedIdentityProviders,
      oAuth: {
        ...oAuthSettings,
        callbackUrls: config.cognito.mobileCallbackUrls,
        logoutUrls:   config.cognito.mobileLogoutUrls,
      },
      preventUserExistenceErrors: true,
      accessTokenValidity:  cdk.Duration.hours(1),
      idTokenValidity:      cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(90),
      enableTokenRevocation: true,
    });

    // ── Hosted UI Domain ──────────────────────────────────────────────────────
    this.userPoolDomain = this.userPool.addDomain('UserPoolDomain', {
      cognitoDomain: { domainPrefix: resourceName(config, 'auth') },
    });

    // ── Resource server + M2M client ──────────────────────────────────────────
    // client_credentials does NOT support openid/email/profile scopes.
    // Scopes must come from a resource server.
    const apiResourceServer = new cognito.UserPoolResourceServer(this, 'ApiResourceServer', {
      userPool: this.userPool,
      identifier: `petvetcare-${config.environment}-api`,
      scopes: [
        new cognito.ResourceServerScope({
          scopeName: 'access',
          scopeDescription: 'Full API access for server-to-server calls',
        }),
      ],
    });

<<<<<<< Updated upstream
    new cdk.CfnOutput(this, 'UserPoolArn', {
      value: this.userPool.userPoolArn,
      exportName: `${stackName(config, 'auth')}:UserPoolArn`,
    });

    new cdk.CfnOutput(this, 'WebUserPoolClientId', {
      value: this.webUserPoolClient.userPoolClientId,
      exportName: `${stackName(config, 'auth')}:WebUserPoolClientId`,
    });

    new cdk.CfnOutput(this, 'MobileUserPoolClientId', {
      value: this.mobileUserPoolClient.userPoolClientId,
      exportName: `${stackName(config, 'auth')}:MobileUserPoolClientId`,
    });

    new cdk.CfnOutput(this, 'CognitoHostedUiUrl', {
      value: `https://${this.userPoolDomain.domainName}.auth.${this.region}.amazoncognito.com`,
    });

    new cdk.CfnOutput(this, 'JwtIssuer', {
      value: `https://cognito-idp.${this.region}.amazonaws.com/${this.userPool.userPoolId}`,
      description: 'JWT issuer URL for API Gateway authorizer and mobile/web clients',
    });
  }
=======
    this.m2mUserPoolClient = this.userPool.addClient('M2MClient', {
      userPoolClientName: resourceName(config, 'm2m-client'),
      generateSecret: true,
      authFlows: { userSrp: false, userPassword: false, custom: false },
      oAuth: {
        flows: { clientCredentials: true },
        scopes: [
          cognito.OAuthScope.resourceServer(
            apiResourceServer,
            new cognito.ResourceServerScope({ scopeName: 'access', scopeDescription: 'Full API access for server-to-server calls' }),
          ),
        ],
      },
      preventUserExistenceErrors: true,
      accessTokenValidity:  cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(1),
      enableTokenRevocation: true,
    });

    // ── Cognito Trigger Lambdas ───────────────────────────────────────────────
    // Placed in auth-stack so there is NO cross-stack Lambda ARN reference.
    // This is the correct pattern to avoid the circular CloudFormation export lock
    // that occurs when trigger ARNs live in a separate compute-stack.
    // Build the UserPool ARN as a string to avoid a circular CDK dependency:
    // UserPool -> Lambda (trigger) AND Lambda IAM policy -> UserPool ARN would cycle.
    // Using a pattern ARN breaks the CDK graph edge without losing security.
    const userPoolArnPattern = this.formatArn({
      service: 'cognito-idp',
      resource: 'userpool',
      resourceName: '*',
    });

    const triggerEnv: Record<string, string> = {
      APP_ENV:          config.environment,
      // COGNITO_USER_POOL_ID intentionally omitted: trigger Lambdas read it
      // from event.userPoolId (always present in Cognito trigger events).
      // Including it here would create a !Ref UserPool in the Lambda env vars,
      // making every trigger Lambda depend on UserPool while UserPool
      // simultaneously depends on those Lambdas -- a CloudFormation cycle.
      OTP_TABLE_NAME:        otpTable.tableName,
      OTP_SALT:              process.env.OTP_SALT ?? 'petvetcare-otp-salt',
      SES_FROM_EMAIL:        sesFromEmail,
      DATABASE_SECRET_ARN:   databaseSecret.secretArn,
      DATABASE_HOST:         dbEndpoint,
      DATABASE_PROXY_ENDPOINT: dbEndpoint,
      DATABASE_PORT:         dbPort,
      DATABASE_NAME:         databaseName,
    };

    const triggerBundling: nodejs.NodejsFunctionProps['bundling'] = {
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
    };
>>>>>>> Stashed changes

    // Use explicit LogGroups instead of the `logRetention` property.
    // The logRetention singleton CustomResource causes CDK to add DependsOn edges that
    // create a circular dependency when Cognito triggers reference Lambdas in the same stack.
    const makeTrigger = (id: string, entry: string, fnName: string): nodejs.NodejsFunction => {
      const logGroup = new logs.LogGroup(this, `${id}LogGroup`, {
        logGroupName: `/aws/lambda/${resourceName(config, fnName)}`,
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      });
      return new nodejs.NodejsFunction(this, id, {
        runtime:     lambda.Runtime.NODEJS_20_X,
        memorySize:  512,
        timeout:     cdk.Duration.seconds(10),
        functionName: resourceName(config, fnName),
        entry:       path.join(__dirname, entry),
        environment: triggerEnv,
        bundling:    triggerBundling,
        logGroup,
      });
    };

    // Function names prefixed 'cognito-trigger-' to avoid clashing with the old
    // trigger Lambdas that currently exist in compute-stack under 'trigger-*' names.
    // Once compute-stack is deleted the old orphaned functions will be cleaned up.
    const defineAuthFn = makeTrigger('DefineAuthChallengeFunction', '../../lambda/triggers/define-auth-challenge.ts', 'cognito-trigger-define-auth');

    const createAuthFn = makeTrigger('CreateAuthChallengeFunction', '../../lambda/triggers/create-auth-challenge.ts', 'cognito-trigger-create-auth');
    otpTable.grantReadWriteData(createAuthFn);
    createAuthFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ses:SendEmail', 'ses:SendRawEmail'],
      resources: ['*'],
    }));

    const verifyAuthFn = makeTrigger('VerifyAuthChallengeFunction', '../../lambda/triggers/verify-auth-challenge.ts', 'cognito-trigger-verify-auth');
    otpTable.grantReadWriteData(verifyAuthFn);

    const preSignUpFn = makeTrigger('PreSignUpFunction', '../../lambda/triggers/pre-sign-up.ts', 'cognito-trigger-pre-signup');
    preSignUpFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['cognito-idp:ListUsers', 'cognito-idp:AdminLinkProviderForUser'],
      resources: [userPoolArnPattern],
    }));

    const postConfirmFn = makeTrigger('PostConfirmationFunction', '../../lambda/triggers/post-confirmation.ts', 'cognito-trigger-post-confirm');
    databaseSecret.grantRead(postConfirmFn);
    postConfirmFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['cognito-idp:AdminUpdateUserAttributes'],
      resources: [userPoolArnPattern],
    }));

    const preTokenFn = makeTrigger('PreTokenGenerationFunction', '../../lambda/triggers/pre-token-generation.ts', 'cognito-trigger-pre-token');

    // Attach triggers -- all Lambdas are in THIS stack, so no cross-stack ARN exports.
    this.userPool.addTrigger(cognito.UserPoolOperation.DEFINE_AUTH_CHALLENGE,         defineAuthFn);
    this.userPool.addTrigger(cognito.UserPoolOperation.CREATE_AUTH_CHALLENGE,         createAuthFn);
    this.userPool.addTrigger(cognito.UserPoolOperation.VERIFY_AUTH_CHALLENGE_RESPONSE, verifyAuthFn);
    this.userPool.addTrigger(cognito.UserPoolOperation.PRE_SIGN_UP,                   preSignUpFn);
    this.userPool.addTrigger(cognito.UserPoolOperation.POST_CONFIRMATION,             postConfirmFn);
    this.userPool.addTrigger(cognito.UserPoolOperation.PRE_TOKEN_GENERATION,          preTokenFn);

    // ── Outputs ───────────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'UserPoolId',          { value: this.userPool.userPoolId,                  exportName: `${stackName(config, 'auth')}:UserPoolId` });
    new cdk.CfnOutput(this, 'UserPoolArn',         { value: this.userPool.userPoolArn,                 exportName: `${stackName(config, 'auth')}:UserPoolArn` });
    new cdk.CfnOutput(this, 'WebUserPoolClientId', { value: this.webUserPoolClient.userPoolClientId,   exportName: `${stackName(config, 'auth')}:WebUserPoolClientId` });
    new cdk.CfnOutput(this, 'MobileUserPoolClientId', { value: this.mobileUserPoolClient.userPoolClientId, exportName: `${stackName(config, 'auth')}:MobileUserPoolClientId` });
    new cdk.CfnOutput(this, 'M2MUserPoolClientId', { value: this.m2mUserPoolClient.userPoolClientId,   exportName: `${stackName(config, 'auth')}:M2MUserPoolClientId` });
    new cdk.CfnOutput(this, 'UserPoolDomainName',  { value: this.userPoolDomain.domainName,            exportName: `${stackName(config, 'auth')}:UserPoolDomainName` });
    new cdk.CfnOutput(this, 'CognitoHostedUiUrl',  { value: `https://${this.userPoolDomain.domainName}.auth.${this.region}.amazoncognito.com` });
    new cdk.CfnOutput(this, 'JwtIssuer',           { value: `https://cognito-idp.${this.region}.amazonaws.com/${this.userPool.userPoolId}`, description: 'JWT issuer URL' });
  }
}
