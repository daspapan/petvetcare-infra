import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as path  from 'path';
import { Construct } from 'constructs';
import { EnvironmentConfig, resourceName } from '../config/environment';
import { defaultTags, stackName } from '../utils/naming';

export interface AuthStackProps extends cdk.StackProps {
  readonly config: EnvironmentConfig;
}

export class AuthStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly webUserPoolClient: cognito.UserPoolClient;
  public readonly mobileUserPoolClient: cognito.UserPoolClient;
  public readonly userPoolDomain: cognito.UserPoolDomain;

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, props);

    const { config } = props;

    Object.entries(defaultTags(config)).forEach(([key, value]) => {
      cdk.Tags.of(this).add(key, value);
    });

    // ─── 1. OTP Rate-Limit Table ─────────────────────────────────────────────
    const otpTable = new dynamodb.Table(this, 'OtpRateLimitTable', {
      tableName: resourceName(config, 'otp-rate-limit'),
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecovery: config.environment === 'prod' ? true : false,
      removalPolicy: config.environment === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
    });

    // ─── 2. Secrets (SNS sender, SES config) ─────────────────────────────────
    /* const authSecret = new secretsmanager.Secret(this, 'AuthSecret', {
      secretName: resourceName(config, 'passwordless-auth-config'),
      description: 'Passwordless auth config (sender IDs, emails)',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({
          smsSenderId: 'AuthApp',
          sesFromEmail: 'noreply@petvetcare.app',
          otpLength: '6',
          otpTtlSeconds: '300',
          maxAttempts: '3',
          maxResends: '5',
        }),
        generateStringKey: 'internalKey',
      },
      removalPolicy: config.environment === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    }); */


    // ─── 3. Lambda Execution Role ─────────────────────────────────────────────
    const lambdaRole = new iam.Role(this, 'LambdaExecutionRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
      inlinePolicies: {
        AuthPolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              actions: ['sns:Publish'],
              resources: ['*'],
              conditions: {
                StringEquals: { 'sns:Type': 'Transactional' },
              },
            }),
            new iam.PolicyStatement({
              actions: ['ses:SendEmail', 'ses:SendRawEmail'],
              resources: ['*'],
            }),
            new iam.PolicyStatement({
              actions: [
                'dynamodb:GetItem', 'dynamodb:PutItem',
                'dynamodb:UpdateItem', 'dynamodb:DeleteItem',
                'dynamodb:Query',
              ],
              resources: [otpTable.tableArn],
            }),
            /* new iam.PolicyStatement({
              actions: ['secretsmanager:GetSecretValue'],
              resources: [authSecret.secretArn],
            }), */
            new iam.PolicyStatement({
              actions: [
                'cognito-idp:AdminGetUser',
                'cognito-idp:AdminCreateUser',
                'cognito-idp:AdminUpdateUserAttributes',
                'cognito-idp:ListUsers',
              ],
              resources: ['*'], // scoped after UserPool creation below
            }),
            new iam.PolicyStatement({
              actions: ['xray:PutTraceSegments', 'xray:PutTelemetryRecords'],
              resources: ['*'],
            }),
          ],
        }),
      },
    });

    // ─── 4. Common Lambda Environment ────────────────────────────────────────
    const commonEnv: Record<string, string> = {
      STAGE: config.environment,
      OTP_TABLE_NAME: otpTable.tableName,
      // SECRET_ARN: authSecret.secretArn,
      POWERTOOLS_SERVICE_NAME: 'passwordless-auth',
      LOG_LEVEL: config.environment === 'prod' ? 'INFO' : 'DEBUG',
      NODE_OPTIONS: '--enable-source-maps',
    };

    const commonLambdaProps: Partial<lambda.FunctionProps> = {
      runtime: lambda.Runtime.NODEJS_20_X,
      role: lambdaRole,
      environment: commonEnv,
      tracing: lambda.Tracing.ACTIVE,
      logRetention: config.environment === 'prod' ? logs.RetentionDays.ONE_MONTH : logs.RetentionDays.ONE_DAY,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      layers: [],
    };

    // ─── 5. Cognito Trigger Lambdas ───────────────────────────────────────────
    
    const preSignUpFn = new nodejs.NodejsFunction(
      this,
      'cognito-pre-signup',
      {
        ...commonLambdaProps,
        functionName: resourceName(config, 'cognito-pre-signup'),
        description: 'Auto-confirm user on sign-up for passwordless flow',
        entry: path.join(__dirname, '../../lambda/handlers/cognito/pre-signup/index.ts'),
        handler: 'handler',
      },
    );

    const defineAuthFn = new nodejs.NodejsFunction(
      this,
      'cognito-define-auth',
      {
        ...commonLambdaProps,
        functionName: resourceName(config, 'cognito-define-auth'),
        description: 'Define authentication challenge flow',
        entry: path.join(__dirname, '../../lambda/handlers/cognito/define-auth/index.ts'),
        handler: 'handler',
      },
    );

    const createChallengeFn = new nodejs.NodejsFunction(
      this,
      'cognito-create-challenge',
      {
        ...commonLambdaProps,
        functionName: resourceName(config, 'cognito-create-challenge'),
        description: 'Generate OTP and dispatch via SNS/SES',
        entry: path.join(__dirname, '../../lambda/handlers/cognito/create-challenge/index.ts'),
        handler: 'handler',
      },
    );

    const verifyChallengeFn = new nodejs.NodejsFunction(
      this,
      'cognito-verify-challenge',
      {
        ...commonLambdaProps,
        functionName: resourceName(config, 'cognito-verify-challenge'),
        description: 'Verify OTP answer from user',
        entry: path.join(__dirname, '../../lambda/handlers/cognito/verify-challenge/index.ts'),
        handler: 'handler',
      },
    );

    const preTokenFn = new nodejs.NodejsFunction(
      this,
      'cognito-pre-token',
      {
        ...commonLambdaProps,
        functionName: resourceName(config, 'cognito-pre-token'),
        description: 'Enrich Cognito tokens with custom claims',
        entry: path.join(__dirname, '../../lambda/handlers/cognito/pre-token/index.ts'),
        handler: 'handler',
      },
    );



    /** Pre-SignUp: auto-confirm users (passwordless — no password verification) */
    /* const preSignUpFn = new lambda.Function(this, 'PreSignUpFn', {
      ...commonLambdaProps,
      functionName: resourceName(config, 'db-bootstrap'),
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../lambda/handlers/cognito/pre-signup')),
      description: 'Auto-confirm user on sign-up for passwordless flow'
    }); */

    /** Define Auth Challenge: orchestrate challenge lifecycle */
    /* const defineAuthFn = new lambda.Function(this, 'DefineAuthFn', {
      ...commonLambdaProps,
      functionName: `${stage}-cognito-define-auth`,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../lambda/handlers/cognito/define-auth')),
      description: 'Define authentication challenge flow',
    }); */

    /** Create Auth Challenge: generate + dispatch OTP */
    /* const createChallengeFn = new lambda.Function(this, 'CreateChallengeFn', {
      ...commonLambdaProps,
      functionName: `${stage}-cognito-create-challenge`,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../lambda/handlers/cognito/create-challenge')),
      description: 'Generate OTP and dispatch via SNS/SES',
      timeout: cdk.Duration.seconds(15),
    }); */

    /** Verify Auth Challenge: validate submitted OTP */
    /* const verifyChallengeFn = new lambda.Function(this, 'VerifyChallengeFn', {
      ...commonLambdaProps,
      functionName: `${stage}-cognito-verify-challenge`,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../lambda/handlers/cognito/verify-challenge')),
      description: 'Verify OTP answer from user',
    }); */

    /** Pre-Token Generation: enrich ID token claims */
    /* const preTokenFn = new lambda.Function(this, 'PreTokenFn', {
      ...commonLambdaProps,
      functionName: `${stage}-cognito-pre-token`,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../lambda/handlers/cognito/pre-token')),
      description: 'Enrich Cognito tokens with custom claims',
    }); */

    // ─── 6. Cognito User Pool ─────────────────────────────────────────────────

    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: config.cognito.userPoolName,
      selfSignUpEnabled: true,
      signInAliases: {
        phone: false,
        email: true,
        username: true,
        preferredUsername: true,
      },
      autoVerify: {
        email: true,
        phone: true,
      },
      standardAttributes: {
        phoneNumber: { required: false, mutable: false },
        email: { required: false, mutable: false },
        fullname: { required: false, mutable: true },
      },
      customAttributes: {
        channel:    new cognito.StringAttribute({ mutable: true }),  // SMS | EMAIL
        deviceType: new cognito.StringAttribute({ mutable: true }),  // mobile | web
        lastLogin:  new cognito.StringAttribute({ mutable: true }),
        tenantId: new cognito.StringAttribute({
          minLen: 1,
          maxLen: 128,
          mutable: true,
        }),
        tenantRole: new cognito.StringAttribute({
          minLen: 1,
          maxLen: 64,
          mutable: true,
        }),
        is_profile_complete: new cognito.BooleanAttribute({ 
          mutable: true 
        }),
        joined_clubs: new cognito.DateTimeAttribute({
          mutable: true,
        }), // comma-separated list of club IDs, e.g. "club1,club2"
      },
      signInCaseSensitive: false,
      passwordPolicy: {
        minLength: 12,
        requireLowercase: false,
        requireUppercase: false,
        requireDigits: false,
        requireSymbols: false,
        tempPasswordValidity: cdk.Duration.days(7),
      },
      accountRecovery: cognito.AccountRecovery.PHONE_AND_EMAIL,
      mfa: cognito.Mfa.OPTIONAL,
      mfaSecondFactor: {
        sms: true,
        otp: true,
      },
      lambdaTriggers: {
        preSignUp:                   preSignUpFn,
        defineAuthChallenge:         defineAuthFn,
        createAuthChallenge:         createChallengeFn,
        verifyAuthChallengeResponse: verifyChallengeFn,
        preTokenGeneration:          preTokenFn,
      },
      userVerification: {
        emailSubject: '[PetVetCare] Your login code',
        emailBody: 'Your verification code is {####} (valid for 5 minutes) since you requested a login to PetVetCare. If you did not request this, please ignore.',
        emailStyle: cognito.VerificationEmailStyle.CODE,
        smsMessage: 'Your verification code is {####}',
      },
      removalPolicy:
        config.environment === 'prod'
          ? cdk.RemovalPolicy.RETAIN
          : cdk.RemovalPolicy.DESTROY,
      deletionProtection: config.environment === 'prod' ? true : false,
      /* advancedSecurityMode: 
        config.environment === 'prod' 
          ? cognito.AdvancedSecurityMode.ENFORCED
          : cognito.AdvancedSecurityMode.OFF, */
    });

    // ── User Groups ────────────────────────────────────────
    const userGroups = [
      { name: 'PetOwnerFree',     precedence: 50 },
      { name: 'PetOwnerPaid',     precedence: 40 },
      { name: 'VeterinaryDoctor', precedence: 30 },
      { name: 'PetMedicineStore', precedence: 20 },
      { name: 'Supervisor',       precedence: 10 },
      { name: 'Admin',            precedence: 1  },
    ];

    userGroups.forEach(g => {
      new cognito.CfnUserPoolGroup(this, `Group${g.name}`, {
        userPoolId:  this.userPool.userPoolId,
        groupName:   g.name,
        precedence:  g.precedence,
        description: `${g.name} user group`,
      });
    });

    if (config.cognito.googleClientId && config.cognito.googleClientSecret) {
      new cognito.UserPoolIdentityProviderGoogle(this, 'GoogleProvider', {
        userPool: this.userPool,
        clientId: config.cognito.googleClientId,
        clientSecretValue: cdk.SecretValue.unsafePlainText(
          config.cognito.googleClientSecret,
        ),
        scopes: ['openid', 'email', 'profile'],
        attributeMapping: {
          email: cognito.ProviderAttribute.GOOGLE_EMAIL,
          givenName: cognito.ProviderAttribute.GOOGLE_GIVEN_NAME,
          familyName: cognito.ProviderAttribute.GOOGLE_FAMILY_NAME,
        },
      });
    }

    if (
      config.cognito.appleClientId &&
      config.cognito.appleTeamId &&
      config.cognito.appleKeyId &&
      config.cognito.applePrivateKey
    ) {
      new cognito.UserPoolIdentityProviderApple(this, 'AppleProvider', {
        userPool: this.userPool,
        clientId: config.cognito.appleClientId,
        teamId: config.cognito.appleTeamId,
        keyId: config.cognito.appleKeyId,
        privateKey: config.cognito.applePrivateKey,
        scopes: ['email', 'name'],
        attributeMapping: {
          email: cognito.ProviderAttribute.APPLE_EMAIL,
          givenName: cognito.ProviderAttribute.APPLE_FIRST_NAME,
          familyName: cognito.ProviderAttribute.APPLE_LAST_NAME,
        },
      });
    }

    const supportedIdentityProviders = [
      cognito.UserPoolClientIdentityProvider.COGNITO,
    ];

    if (config.cognito.googleClientId && config.cognito.googleClientSecret) {
      supportedIdentityProviders.push(
        cognito.UserPoolClientIdentityProvider.GOOGLE,
      );
    }

    if (
      config.cognito.appleClientId &&
      config.cognito.appleTeamId &&
      config.cognito.appleKeyId &&
      config.cognito.applePrivateKey
    ) {
      supportedIdentityProviders.push(
        cognito.UserPoolClientIdentityProvider.APPLE,
      );
    }

    const oAuthSettings: cognito.OAuthSettings = {
      flows: {
        authorizationCodeGrant: true,
        implicitCodeGrant: false,
      },
      scopes: [
        cognito.OAuthScope.OPENID,
        cognito.OAuthScope.EMAIL,
        cognito.OAuthScope.PROFILE,
      ],
    };

    this.webUserPoolClient = this.userPool.addClient('WebClient', {
      userPoolClientName: resourceName(config, 'web-client'),
      generateSecret: false,
      authFlows: {
        userSrp: false,
        userPassword: false,
        custom: true,
      },
      supportedIdentityProviders,
      oAuth: {
        ...oAuthSettings,
        callbackUrls: config.cognito.webCallbackUrls,
        logoutUrls: config.cognito.webLogoutUrls,
      },
      preventUserExistenceErrors: true,
      accessTokenValidity: cdk.Duration.hours(1),
      idTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(30),
      enableTokenRevocation: true,
    });

    this.mobileUserPoolClient = this.userPool.addClient('MobileClient', {
      userPoolClientName: resourceName(config, 'mobile-client'),
      generateSecret: false,
      authFlows: {
        userSrp: false,
        userPassword: false,
        custom: true,
      },
      supportedIdentityProviders,
      oAuth: {
        ...oAuthSettings,
        callbackUrls: config.cognito.mobileCallbackUrls,
        logoutUrls: config.cognito.mobileLogoutUrls,
      },
      preventUserExistenceErrors: true,
      accessTokenValidity: cdk.Duration.hours(1),
      idTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(90),
      enableTokenRevocation: true,
    });

    this.userPoolDomain = this.userPool.addDomain('UserPoolDomain', {
      cognitoDomain: {
        domainPrefix: resourceName(config, 'auth'),
      },
    });

    new cdk.CfnOutput(this, 'UserPoolId', {
      value: this.userPool.userPoolId,
      exportName: `${stackName(config, 'auth')}:UserPoolId`,
    });

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

  /**
   * Attach enterprise SAML/OIDC identity providers for partner clinics and NGOs.
   * Call this from a separate deployment step once partner metadata is available.
   */
  public addEnterpriseOidcProvider(
    id: string,
    props: {
      name: string;
      issuerUrl: string;
      clientId: string;
      clientSecret: string;
      scopes?: string[];
      attributeMapping?: cognito.AttributeMapping;
    },
  ): cognito.UserPoolIdentityProviderOidc {
    return new cognito.UserPoolIdentityProviderOidc(this, id, {
      userPool: this.userPool,
      name: props.name,
      issuerUrl: props.issuerUrl,
      clientId: props.clientId,
      clientSecret: props.clientSecret,
      scopes: props.scopes ?? ['openid', 'email', 'profile'],
      attributeMapping: props.attributeMapping ?? {
        email: cognito.ProviderAttribute.other('email'),
        givenName: cognito.ProviderAttribute.other('given_name'),
        familyName: cognito.ProviderAttribute.other('family_name'),
      },
    });
  }

  public addEnterpriseSamlProvider(
    id: string,
    props: {
      name: string;
      metadata: cognito.UserPoolIdentityProviderSamlMetadata;
      attributeMapping?: cognito.AttributeMapping;
    },
  ): cognito.UserPoolIdentityProviderSaml {
    return new cognito.UserPoolIdentityProviderSaml(this, id, {
      userPool: this.userPool,
      name: props.name,
      metadata: props.metadata,
      attributeMapping: props.attributeMapping ?? {
        email: cognito.ProviderAttribute.other(
          'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress',
        ),
        givenName: cognito.ProviderAttribute.other(
          'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname',
        ),
        familyName: cognito.ProviderAttribute.other(
          'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname',
        ),
      },
    });
  }
}
