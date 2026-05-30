import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
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

    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: config.cognito.userPoolName,
      selfSignUpEnabled: true,
      signInAliases: {
        email: true,
        username: false,
      },
      autoVerify: {
        email: true,
      },
      standardAttributes: {
        email: {
          required: true,
          mutable: true,
        },
        givenName: {
          required: false,
          mutable: true,
        },
        familyName: {
          required: false,
          mutable: true,
        },
      },
      customAttributes: {
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
      mfaSecondFactor: {
        sms: false,
        otp: true,
      },
      removalPolicy:
        config.environment === 'prod'
          ? cdk.RemovalPolicy.RETAIN
          : cdk.RemovalPolicy.DESTROY,
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
        userSrp: true,
        userPassword: false,
        custom: false,
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
        userSrp: true,
        userPassword: false,
        custom: false,
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
