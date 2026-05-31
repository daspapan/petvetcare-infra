import * as cdk from 'aws-cdk-lib';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigatewayv2Authorizers from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import * as apigatewayv2Integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53Targets from 'aws-cdk-lib/aws-route53-targets';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import * as path from 'path';
import { EnvironmentConfig, resourceName } from '../config/environment';
import { defaultTags, stackName } from '../utils/naming';

export interface ApiStackProps extends cdk.StackProps {
  readonly config: EnvironmentConfig;
  readonly vpc: ec2.IVpc;
  readonly lambdaSecurityGroup: ec2.ISecurityGroup;
  readonly userPool: cognito.IUserPool;
  readonly userPoolClients: cognito.IUserPoolClient[];
  readonly userContentBucket: s3.IBucket;
  readonly presignedUrlRole: iam.IRole;
  readonly databaseSecret: secretsmanager.ISecret;
  readonly databaseEndpoint: string;
  readonly databasePort: string;
  readonly databaseName: string;
  readonly hostedZone: route53.IHostedZone;
  readonly cdnDomainName: string;
}

export class ApiStack extends cdk.Stack {
  public readonly httpApi: apigatewayv2.HttpApi;
  public readonly apiDomainName: string;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const {
      config,
      vpc,
      lambdaSecurityGroup,
      userPool,
      userPoolClients,
      userContentBucket,
      presignedUrlRole,
      databaseSecret,
      databaseEndpoint,
      databasePort,
      databaseName,
      hostedZone,
      cdnDomainName,
    } = props;

    this.apiDomainName = `${config.apiSubdomain}.${config.domainName}`;

    Object.entries(defaultTags(config)).forEach(([key, value]) => {
      cdk.Tags.of(this).add(key, value);
    });

    const lambdaEnvironment = {
      APP_ENV: config.environment,
      DATABASE_SECRET_ARN: databaseSecret.secretArn,
      DATABASE_HOST: databaseEndpoint,
      DATABASE_PORT: databasePort,
      DATABASE_NAME: databaseName,
      USER_CONTENT_BUCKET: userContentBucket.bucketName,
      CDN_DOMAIN: cdnDomainName,
      COGNITO_USER_POOL_ID: userPool.userPoolId,
      COGNITO_REGION: this.region,
    };

    const lambdaDefaults: nodejs.NodejsFunctionProps = {
      runtime: lambda.Runtime.NODEJS_20_X,
      memorySize: 512,
      timeout: cdk.Duration.seconds(29),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [lambdaSecurityGroup],
      environment: lambdaEnvironment,
      bundling: {
        minify: true,
        sourceMap: true,
        target: 'node20',
        externalModules: ['@aws-sdk/client-secrets-manager', '@aws-sdk/client-s3', '@aws-sdk/s3-request-presigner'],
      },
      logRetention: logs.RetentionDays.ONE_DAY, // TODO: increase to 1 month for production, and consider log group
    };

    const healthFunction = new nodejs.NodejsFunction(this, 'HealthFunction', {
      ...lambdaDefaults,
      functionName: resourceName(config, 'health'),
      entry: path.join(__dirname, '../../lambda/handlers/health.ts'),
      description: 'Public health check endpoint',
    });

    const petsFunction = new nodejs.NodejsFunction(this, 'PetsFunction', {
      ...lambdaDefaults,
      functionName: resourceName(config, 'pets'),
      entry: path.join(__dirname, '../../lambda/handlers/pets.ts'),
      description: 'Pet health record CRUD operations',
    });

    const uploadsFunction = new nodejs.NodejsFunction(this, 'UploadsFunction', {
      ...lambdaDefaults,
      functionName: resourceName(config, 'uploads'),
      entry: path.join(__dirname, '../../lambda/handlers/uploads.ts'),
      description: 'Generates pre-signed S3 URLs for secure client uploads',
      role: presignedUrlRole,
    });

    databaseSecret.grantRead(petsFunction);
    userContentBucket.grantReadWrite(uploadsFunction);

    const googleCalendarSecret = new secretsmanager.Secret(
      this,
      'GoogleCalendarOAuthSecret',
      {
        secretName: resourceName(config, 'google-calendar-oauth'),
        description: 'Google Calendar OAuth credentials for vet visit bookings',
        secretObjectValue: {
          clientId: cdk.SecretValue.unsafePlainText(
            process.env.GOOGLE_CALENDAR_CLIENT_ID ?? 'REPLACE_ME',
          ),
          clientSecret: cdk.SecretValue.unsafePlainText(
            process.env.GOOGLE_CALENDAR_CLIENT_SECRET ?? 'REPLACE_ME',
          ),
          redirectUri: cdk.SecretValue.unsafePlainText(
            process.env.GOOGLE_CALENDAR_REDIRECT_URI ??
              `https://${this.apiDomainName}/integrations/google/callback`,
          ),
        },
      },
    );

    const googleCalendarFunction = new nodejs.NodejsFunction(
      this,
      'GoogleCalendarFunction',
      {
        ...lambdaDefaults,
        functionName: resourceName(config, 'google-calendar'),
        entry: path.join(
          __dirname,
          '../../lambda/handlers/google-calendar.ts',
        ),
        description: 'Google Calendar integration for vet visit bookings',
        environment: {
          ...lambdaEnvironment,
          GOOGLE_CALENDAR_SECRET_ARN: googleCalendarSecret.secretArn,
        },
      },
    );

    googleCalendarSecret.grantRead(googleCalendarFunction);

    const remindersFunction = new nodejs.NodejsFunction(
      this,
      'RemindersFunction',
      {
        ...lambdaDefaults,
        functionName: resourceName(config, 'reminders'),
        entry: path.join(__dirname, '../../lambda/handlers/reminders.ts'),
        description:
          'Processes vaccination and deworming reminder background jobs',
        timeout: cdk.Duration.minutes(5),
      },
    );

    databaseSecret.grantRead(remindersFunction);

    const jwtAuthorizer = new apigatewayv2Authorizers.HttpJwtAuthorizer(
      'CognitoJwtAuthorizer',
      `https://cognito-idp.${this.region}.amazonaws.com/${userPool.userPoolId}`,
      {
        jwtAudience: userPoolClients.map((client) => client.userPoolClientId),
        identitySource: ['$request.header.Authorization'],
      },
    );

    const corsPreflight: apigatewayv2.CorsPreflightOptions = {
      allowOrigins: [
        config.cors.webAppOrigin,
        ...(config.cors.mobileAppOrigin !== '*'
          ? [config.cors.mobileAppOrigin]
          : ['*']),
      ],
      allowHeaders: config.cors.allowHeaders,
      allowMethods: config.cors.allowMethods.map(
        (method) => method as apigatewayv2.CorsHttpMethod,
      ),
      maxAge: cdk.Duration.hours(1),
      allowCredentials: config.cors.mobileAppOrigin !== '*',
    };

    this.httpApi = new apigatewayv2.HttpApi(this, 'HttpApi', {
      apiName: resourceName(config, 'http-api'),
      description:
        'Unified API entry point for Pet Vet Care web and future mobile clients',
      corsPreflight,
      createDefaultStage: true,
      defaultDomainMapping: undefined,
    });

    this.httpApi.addRoutes({
      path: '/health',
      methods: [apigatewayv2.HttpMethod.GET],
      integration: new apigatewayv2Integrations.HttpLambdaIntegration(
        'HealthIntegration',
        healthFunction,
      ),
    });

    this.httpApi.addRoutes({
      path: '/pets',
      methods: [apigatewayv2.HttpMethod.GET, apigatewayv2.HttpMethod.POST],
      integration: new apigatewayv2Integrations.HttpLambdaIntegration(
        'PetsIntegration',
        petsFunction,
      ),
      authorizer: jwtAuthorizer,
    });

    this.httpApi.addRoutes({
      path: '/pets/{petId}',
      methods: [
        apigatewayv2.HttpMethod.GET,
        apigatewayv2.HttpMethod.PUT,
        apigatewayv2.HttpMethod.DELETE,
      ],
      integration: new apigatewayv2Integrations.HttpLambdaIntegration(
        'PetByIdIntegration',
        petsFunction,
      ),
      authorizer: jwtAuthorizer,
    });

    this.httpApi.addRoutes({
      path: '/uploads/presign',
      methods: [apigatewayv2.HttpMethod.POST],
      integration: new apigatewayv2Integrations.HttpLambdaIntegration(
        'UploadsIntegration',
        uploadsFunction,
      ),
      authorizer: jwtAuthorizer,
    });

    this.httpApi.addRoutes({
      path: '/integrations/google/{proxy+}',
      methods: [apigatewayv2.HttpMethod.ANY],
      integration: new apigatewayv2Integrations.HttpLambdaIntegration(
        'GoogleCalendarIntegration',
        googleCalendarFunction,
      ),
      authorizer: jwtAuthorizer,
    });

    const apiCertificate = new acm.Certificate(this, 'ApiCertificate', {
      domainName: this.apiDomainName,
      validation: acm.CertificateValidation.fromDns(hostedZone),
    });

    const apiDomain = new apigatewayv2.DomainName(this, 'ApiDomainName', {
      domainName: this.apiDomainName,
      certificate: apiCertificate,
    });

    new apigatewayv2.ApiMapping(this, 'ApiMapping', {
      api: this.httpApi,
      domainName: apiDomain,
      stage: this.httpApi.defaultStage!,
    });

    new route53.ARecord(this, 'ApiAliasRecord', {
      zone: hostedZone,
      recordName: config.apiSubdomain,
      target: route53.RecordTarget.fromAlias(
        new route53Targets.ApiGatewayv2DomainProperties(
          apiDomain.regionalDomainName,
          apiDomain.regionalHostedZoneId,
        ),
      ),
    });

    const remindersRule = new events.Rule(this, 'RemindersScheduleRule', {
      ruleName: resourceName(config, 'reminders-daily'),
      description:
        'Daily cron trigger for AI-based vaccination and deworming reminders',
      schedule: events.Schedule.cron({
        minute: '0',
        hour: '8',
        month: '*',
        weekDay: '*',
        year: '*',
      }),
    });

    remindersRule.addTarget(
      new targets.LambdaFunction(remindersFunction, {
        retryAttempts: 2,
      }),
    );

    new events.EventBus(this, 'ApplicationEventBus', {
      eventBusName: resourceName(config, 'events'),
    });

    new cdk.CfnOutput(this, 'HttpApiUrl', {
      value: this.httpApi.apiEndpoint,
      exportName: `${stackName(config, 'api')}:HttpApiUrl`,
    });

    new cdk.CfnOutput(this, 'CustomApiUrl', {
      value: `https://${this.apiDomainName}`,
      exportName: `${stackName(config, 'api')}:CustomApiUrl`,
    });

    new cdk.CfnOutput(this, 'GoogleCalendarSecretArn', {
      value: googleCalendarSecret.secretArn,
    });

    new cdk.CfnOutput(this, 'RemindersFunctionArn', {
      value: remindersFunction.functionArn,
    });
  }
}
