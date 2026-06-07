import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
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
import * as rds from 'aws-cdk-lib/aws-rds';
import * as path from 'path';
import { apiDomainName, EnvironmentConfig, resourceName } from '../config/environment';
import { defaultTags, stackName } from '../utils/naming';

export interface ApiStackProps extends cdk.StackProps {
  readonly config: EnvironmentConfig;
  readonly vpc: ec2.IVpc;
  readonly lambdaSecurityGroup: ec2.ISecurityGroup;
  readonly userPool: cognito.IUserPool;
  readonly userPoolClients: cognito.IUserPoolClient[];
  readonly publicAssetBucket: s3.IBucket;
  readonly presignedUrlRole: iam.IRole;
  readonly databaseSecret: secretsmanager.ISecret;
  readonly databaseProxyEndpoint: string;
  readonly databasePort: string;
  readonly databaseName: string;
  readonly hostedZone: route53.IHostedZone;
  readonly publicAssetUrl: string;
  readonly databaseProxy: rds.DatabaseProxy;
}

export class ApiStack extends cdk.Stack {
  public readonly restApi: apigateway.RestApi;
  public readonly eventBus: events.EventBus;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const {
      config,
      vpc,
      lambdaSecurityGroup,
      userPool,
      userPoolClients,
      publicAssetBucket,
      presignedUrlRole,
      databaseSecret,
      databaseProxyEndpoint,
      databasePort,
      databaseName,
      hostedZone,
      publicAssetUrl,
      databaseProxy,
    } = props;

    const domain = apiDomainName(config);

    Object.entries(defaultTags(config)).forEach(([key, value]) => {
      cdk.Tags.of(this).add(key, value);
    });

    this.eventBus = new events.EventBus(this, 'ApplicationEventBus', {
      eventBusName: resourceName(config, 'events'),
    });

    const lambdaEnvironment: Record<string, string> = {
      APP_ENV: config.environment,
      DATABASE_SECRET_ARN: databaseSecret.secretArn,
      DATABASE_HOST: databaseProxyEndpoint,
      DATABASE_PROXY_ENDPOINT: databaseProxyEndpoint,
      DATABASE_PORT: databasePort,
      DATABASE_NAME: databaseName,
      PUBLIC_ASSET_BUCKET: publicAssetBucket.bucketName,
      PUBLIC_ASSET_URL: publicAssetUrl,
      COGNITO_USER_POOL_ID: userPool.userPoolId,
      COGNITO_CLIENT_ID: userPoolClients[0].userPoolClientId,
      COGNITO_REGION: this.region,
      EVENT_BUS_NAME: this.eventBus.eventBusName,
      CORS_ORIGIN: config.cors.webAppOrigin,
      SES_FROM_EMAIL: process.env.SES_FROM_EMAIL ?? 'noreply@petvetcare.app',
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
        externalModules: [
          '@aws-sdk/client-secrets-manager',
          '@aws-sdk/client-s3',
          '@aws-sdk/s3-request-presigner',
          '@aws-sdk/client-cognito-identity-provider',
          '@aws-sdk/client-ses',
          '@aws-sdk/client-eventbridge'
        ],
        nodeModules: ['pg']
      },
      logRetention: logs.RetentionDays.ONE_DAY, // TODO: increase to 1 month for production, and consider log group
    };

    const createFn = (
      id: string,
      entry: string,
      fnName: string,
      role?: iam.IRole,
      timeout?: cdk.Duration,
      extraBundling?: nodejs.NodejsFunctionProps['bundling'],
    ): nodejs.NodejsFunction => {
      const fn = new nodejs.NodejsFunction(this, id, {
        ...lambdaDefaults,
        functionName: resourceName(config, fnName),
        entry: path.join(__dirname, entry),
        role,
        timeout: timeout ?? lambdaDefaults.timeout,
        bundling: extraBundling
          ? { ...lambdaDefaults.bundling, ...extraBundling }
          : lambdaDefaults.bundling,
      });
      databaseSecret.grantRead(fn);
      databaseProxy.grantConnect(fn, 'petvetcare_admin');
      return fn;
    };

    const migrationBundling: nodejs.NodejsFunctionProps['bundling'] = {
      ...lambdaDefaults.bundling,
      commandHooks: {
        beforeBundling(): string[] {
          return [];
        },
        beforeInstall(): string[] {
          return [];
        },
        afterBundling(inputDir: string, outputDir: string): string[] {
          return [
            `mkdir -p ${outputDir}/database`,
            `cp -r ${inputDir}/database/migrations ${outputDir}/database/migrations`,
          ];
        },
      },
    };

<<<<<<< Updated upstream
    const healthFn = createFn('HealthFunction', '../../lambda/handlers/health.ts', 'health');
    const authFn = createFn('AuthFunction', '../../lambda/handlers/auth.ts', 'auth');
    authFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ses:SendEmail', 'ses:SendRawEmail'],
        resources: ['*'],
      }),
    );
    authFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['cognito-idp:AdminInitiateAuth', 'cognito-idp:AdminRespondToAuthChallenge', 'cognito-idp:GlobalSignOut'],
        resources: [userPool.userPoolArn],
      }),
    );

    const profileFn = createFn('ProfileFunction', '../../lambda/handlers/profile.ts', 'profile');
    const petsFn = createFn('PetsFunction', '../../lambda/handlers/pets.ts', 'pets');
    const healthRecordsFn = createFn('HealthRecordsFunction', '../../lambda/handlers/health-records.ts', 'health-records');
    const vaccinationsFn = createFn('VaccinationsFunction', '../../lambda/handlers/vaccinations.ts', 'vaccinations');
    const prescriptionsFn = createFn('PrescriptionsFunction', '../../lambda/handlers/prescriptions.ts', 'prescriptions');
    const appointmentsFn = createFn('AppointmentsFunction', '../../lambda/handlers/appointments.ts', 'appointments');
    const doctorsFn = createFn('DoctorsFunction', '../../lambda/handlers/doctors.ts', 'doctors');
    const storesFn = createFn('StoresFunction', '../../lambda/handlers/stores.ts', 'stores');
    const productsFn = createFn('ProductsFunction', '../../lambda/handlers/products.ts', 'products');
    const ordersFn = createFn('OrdersFunction', '../../lambda/handlers/orders.ts', 'orders');
    const paymentsFn = createFn('PaymentsFunction', '../../lambda/handlers/payments.ts', 'payments');
    const ticketsFn = createFn('TicketsFunction', '../../lambda/handlers/tickets.ts', 'tickets');
    const adminFn = createFn('AdminFunction', '../../lambda/handlers/admin.ts', 'admin');
    const filesFn = createFn('FilesFunction', '../../lambda/handlers/files.ts', 'files', presignedUrlRole);
    const dbMigrationFn = createFn(
      'DatabaseMigrationFunction',
      '../../lambda/handlers/database-migration.ts',
      'db-migration',
      undefined,
      cdk.Duration.minutes(5),
      migrationBundling,
    );

    const remindersFn = createFn(
      'RemindersFunction',
      '../../lambda/handlers/reminders.ts',
      'reminders',
      undefined,
      cdk.Duration.minutes(5),
    );
=======
    const healthFn        = createFn('HealthFunction',        '../../lambda/handlers/health.ts',           'health');
    const meFn            = createFn('MeFunction',            '../../lambda/handlers/auth.ts',             'auth-me');
    // const profileFn       = createFn('ProfileFunction',       '../../lambda/handlers/profile.ts',          'profile');
    // const petsFn          = createFn('PetsFunction',          '../../lambda/handlers/pets.ts',             'pets');
    // const healthRecordsFn = createFn('HealthRecordsFunction', '../../lambda/handlers/health-records.ts',   'health-records');
    // const vaccinationsFn  = createFn('VaccinationsFunction',  '../../lambda/handlers/vaccinations.ts',     'vaccinations');
    // const prescriptionsFn = createFn('PrescriptionsFunction', '../../lambda/handlers/prescriptions.ts',    'prescriptions');
    // const appointmentsFn  = createFn('AppointmentsFunction',  '../../lambda/handlers/appointments.ts',     'appointments');
    // const doctorsFn       = createFn('DoctorsFunction',       '../../lambda/handlers/doctors.ts',          'doctors');
    // const storesFn        = createFn('StoresFunction',        '../../lambda/handlers/stores.ts',           'stores');
    // const productsFn      = createFn('ProductsFunction',      '../../lambda/handlers/products.ts',         'products');
    // const ordersFn        = createFn('OrdersFunction',        '../../lambda/handlers/orders.ts',           'orders');
    // const paymentsFn      = createFn('PaymentsFunction',      '../../lambda/handlers/payments.ts',         'payments');
    // const ticketsFn       = createFn('TicketsFunction',       '../../lambda/handlers/tickets.ts',          'tickets');
    // const adminFn         = createFn('AdminFunction',         '../../lambda/handlers/admin.ts',            'admin');
    // const filesFn         = createFn('FilesFunction',         '../../lambda/handlers/files.ts',            'files', presignedUrlRole);
    // const dbMigrationFn   = createFn('DatabaseMigrationFunction', '../../lambda/handlers/database-migration.ts', 'db-migration', undefined, cdk.Duration.minutes(5), migrationBundling);
    // const remindersFn     = createFn('RemindersFunction',     '../../lambda/handlers/reminders.ts',        'reminders', undefined, cdk.Duration.minutes(5));
>>>>>>> Stashed changes

    /* publicAssetBucket.grantReadWrite(filesFn);

    [petsFn, appointmentsFn, ordersFn, storesFn].forEach((fn) => {
<<<<<<< Updated upstream
      fn.addToRolePolicy(
        new iam.PolicyStatement({
          actions: ['events:PutEvents'],
          resources: [this.eventBus.eventBusArn],
        }),
      );
    });
=======
      fn.addToRolePolicy(new iam.PolicyStatement({
        actions: ['events:PutEvents'],
        resources: [this.eventBus.eventBusArn],
      }));
    }); */
>>>>>>> Stashed changes

    this.restApi = new apigateway.RestApi(this, 'RestApi', {
      restApiName: resourceName(config, 'rest-api'),
      description: 'PetVetCare unified REST API for web and mobile clients',
      cloudWatchRole: true,
      deployOptions: {
        stageName: config.environment,
        tracingEnabled: true,
        metricsEnabled: true,
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        dataTraceEnabled: config.environment !== 'prod',
      },
      defaultCorsPreflightOptions: {
        allowOrigins:
          config.cors.mobileAppOrigin === '*'
            ? apigateway.Cors.ALL_ORIGINS
            : [config.cors.webAppOrigin, config.cors.mobileAppOrigin],
        allowHeaders: config.cors.allowHeaders,
        allowMethods: config.cors.allowMethods,
        allowCredentials: config.cors.mobileAppOrigin !== '*',
      },
    });

    const authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'CognitoAuthorizer', {
      cognitoUserPools: [userPool],
      authorizerName: resourceName(config, 'cognito-authorizer'),
      identitySource: 'method.request.header.Authorization',
    });

    const addRoute = (
      resourcePath: string,
      method: string,
      fn: lambda.IFunction,
      auth = true,
    ): void => {
      const parts = resourcePath.split('/').filter(Boolean);
      let resource = this.restApi.root;
      for (const part of parts) {
        const existing = resource.getResource(part);
        resource = existing ?? resource.addResource(part);
      }
      const integration = new apigateway.LambdaIntegration(fn);
      resource.addMethod(method, integration, auth
        ? { authorizer, authorizationType: apigateway.AuthorizationType.COGNITO }
        : undefined);
    };

    // Public routes
    // aws logs tail /aws/lambda/petvetcare-dev-auth --follow
    addRoute('health', 'GET', healthFn, false);
    addRoute('auth/send-otp', 'POST', authFn, false);
    addRoute('auth/verify-otp', 'POST', authFn, false);

    // Auth routes (JWT required)
    addRoute('auth/logout', 'POST', authFn);
    addRoute('auth/me', 'GET', authFn);

<<<<<<< Updated upstream
    // Profile
    addRoute('profile', 'GET', profileFn);
    addRoute('profile', 'PUT', profileFn);
    addRoute('profile/avatar', 'POST', profileFn);
=======
    // ── Profile ──────────────────────────────────────────────────────────────
    /* addRoute('profile',        'GET',    profileFn);
    addRoute('profile',        'PUT',    profileFn);
    addRoute('profile/avatar', 'POST',   profileFn);
>>>>>>> Stashed changes
    addRoute('profile/avatar', 'DELETE', profileFn);

    // Pets
    addRoute('pets', 'GET', petsFn);
    addRoute('pets', 'POST', petsFn);
    addRoute('pets/{petId}', 'GET', petsFn);
    addRoute('pets/{petId}', 'PUT', petsFn);
    addRoute('pets/{petId}', 'DELETE', petsFn);

    // Health records
    addRoute('pets/{petId}/health-records', 'GET', healthRecordsFn);
    addRoute('pets/{petId}/health-records', 'POST', healthRecordsFn);
    addRoute('pets/{petId}/health-records/{recordId}', 'PUT', healthRecordsFn);
    addRoute('pets/{petId}/health-records/{recordId}', 'DELETE', healthRecordsFn);

    // Vaccinations
    addRoute('pets/{petId}/vaccinations', 'GET', vaccinationsFn);
    addRoute('pets/{petId}/vaccinations', 'POST', vaccinationsFn);
    addRoute('vaccinations/{vaccinationId}', 'PUT', vaccinationsFn);
    addRoute('vaccinations/{vaccinationId}', 'DELETE', vaccinationsFn);

    // Prescriptions
    addRoute('pets/{petId}/prescriptions', 'GET', prescriptionsFn);
    addRoute('pets/{petId}/prescriptions', 'POST', prescriptionsFn);
    addRoute('prescriptions/{id}', 'GET', prescriptionsFn);
    addRoute('prescriptions/{id}', 'DELETE', prescriptionsFn);

    // Appointments
    addRoute('appointments', 'GET', appointmentsFn);
    addRoute('appointments', 'POST', appointmentsFn);
    addRoute('appointments/{appointmentId}', 'GET', appointmentsFn);
    addRoute('appointments/{appointmentId}', 'PUT', appointmentsFn);
    addRoute('appointments/{appointmentId}', 'DELETE', appointmentsFn);

    // Doctors
    addRoute('doctors', 'GET', doctorsFn);
    addRoute('doctors', 'POST', doctorsFn);
    addRoute('doctors/{doctorId}', 'GET', doctorsFn);
    addRoute('doctors/{doctorId}', 'PUT', doctorsFn);
    addRoute('doctors/{doctorId}', 'DELETE', doctorsFn);

    // Stores
    addRoute('stores/register', 'POST', storesFn);
    addRoute('stores', 'GET', storesFn);
    addRoute('stores/{storeId}', 'GET', storesFn);
    addRoute('stores/{storeId}', 'PUT', storesFn);
    addRoute('stores/{storeId}', 'DELETE', storesFn);
    addRoute('stores/{storeId}/approve', 'POST', storesFn);
    addRoute('stores/{storeId}/reject', 'POST', storesFn);

    // Products
    addRoute('products', 'GET', productsFn);
    addRoute('products', 'POST', productsFn);
    addRoute('products/{productId}', 'GET', productsFn);
    addRoute('products/{productId}', 'PUT', productsFn);
    addRoute('products/{productId}', 'DELETE', productsFn);

    // Orders & Payments
    addRoute('orders', 'GET', ordersFn);
    addRoute('orders', 'POST', ordersFn);
    addRoute('orders/{orderId}', 'GET', ordersFn);
    addRoute('orders/{orderId}', 'PUT', ordersFn);
    addRoute('payments/initiate', 'POST', paymentsFn);
    addRoute('payments/success', 'POST', paymentsFn);
    addRoute('payments/failure', 'POST', paymentsFn);
    addRoute('payments/{paymentId}', 'GET', paymentsFn);

    // Tickets
    addRoute('tickets', 'GET', ticketsFn);
    addRoute('tickets', 'POST', ticketsFn);
    addRoute('tickets/{ticketId}', 'GET', ticketsFn);
    addRoute('tickets/{ticketId}', 'PUT', ticketsFn);
    addRoute('tickets/{ticketId}/comment', 'POST', ticketsFn);
    addRoute('tickets/{ticketId}/assign', 'POST', ticketsFn);
    addRoute('tickets/{ticketId}/close', 'POST', ticketsFn);

    // Admin
    addRoute('admin/dashboard', 'GET', adminFn);
    addRoute('admin/users', 'GET', adminFn);
    addRoute('admin/audit-logs', 'GET', adminFn);
    addRoute('admin/analytics', 'GET', adminFn);
    addRoute('admin/database/migrate', 'POST', dbMigrationFn);
    addRoute('admin/database/rollback', 'POST', dbMigrationFn);
    addRoute('admin/database/migrations', 'GET', dbMigrationFn);

<<<<<<< Updated upstream
    // Files
    addRoute('files/presigned-url', 'POST', filesFn);
    addRoute('files/complete-upload', 'POST', filesFn);
=======
    // ── Files ─────────────────────────────────────────────────────────────────
    addRoute('files/presigned-url',   'POST', filesFn);
    addRoute('files/complete-upload', 'POST', filesFn); */
>>>>>>> Stashed changes

    if (config.certificates.apiCertificateArn) {
      const apiCertificate = acm.Certificate.fromCertificateArn(
        this,
        'ApiCertificate',
        config.certificates.apiCertificateArn,
      );

      const apiDomain = this.restApi.addDomainName('ApiDomainName', {
        domainName: domain,
        certificate: apiCertificate,
        securityPolicy: apigateway.SecurityPolicy.TLS_1_2,
        endpointType: apigateway.EndpointType.REGIONAL,
      });

      if (config.dns.createDnsRecords) {
        new route53.ARecord(this, 'ApiAliasRecord', {
          zone: hostedZone,
          recordName: config.apiSubdomain,
          target: route53.RecordTarget.fromAlias(
            new route53Targets.ApiGatewayDomain(apiDomain),
          ),
        });
      }

      new cdk.CfnOutput(this, 'CustomApiUrl', {
        value: `https://${domain}`,
        exportName: `${stackName(config, 'api')}:CustomApiUrl`,
      });
    }

<<<<<<< Updated upstream
    new events.Rule(this, 'RemindersScheduleRule', {
=======
    // ── Scheduled jobs ────────────────────────────────────────────────────────
    /* new events.Rule(this, 'RemindersScheduleRule', {
>>>>>>> Stashed changes
      ruleName: resourceName(config, 'reminders-daily'),
      schedule: events.Schedule.cron({ minute: '0', hour: '8' }),
      targets: [new targets.LambdaFunction(remindersFn)],
    }); */

    new cdk.CfnOutput(this, 'RestApiUrl', {
      value: this.restApi.url,
      exportName: `${stackName(config, 'api')}:RestApiUrl`,
    });

    new cdk.CfnOutput(this, 'EventBusName', {
      value: this.eventBus.eventBusName,
    });
  }
}
