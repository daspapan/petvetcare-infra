import * as cdk from 'aws-cdk-lib';
import * as cr from 'aws-cdk-lib/custom-resources';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import * as path from 'path';
import { EnvironmentConfig, resourceName } from '../config/environment';
import { defaultTags, stackName } from '../utils/naming';

export interface DatabaseStackProps extends cdk.StackProps {
  readonly config: EnvironmentConfig;
  readonly vpc: ec2.IVpc;
  readonly lambdaSecurityGroup: ec2.ISecurityGroup;
}

export class DatabaseStack extends cdk.Stack {
  public readonly cluster: rds.DatabaseCluster;
  public readonly credentials: secretsmanager.ISecret;
  public readonly proxy: rds.DatabaseProxy;

  constructor(scope: Construct, id: string, props: DatabaseStackProps) {
    super(scope, id, props);

    const { config, vpc, lambdaSecurityGroup } = props;

    Object.entries(defaultTags(config)).forEach(([key, value]) => {
      cdk.Tags.of(this).add(key, value);
    });

    const databaseSecurityGroup = new ec2.SecurityGroup(this, 'DatabaseSecurityGroup', {
      vpc,
      securityGroupName: resourceName(config, 'database-sg'),
      description: 'Security group for Aurora PostgreSQL cluster',
      allowAllOutbound: false,
    });

    const proxySecurityGroup = new ec2.SecurityGroup(this, 'ProxySecurityGroup', {
      vpc,
      securityGroupName: resourceName(config, 'rds-proxy-sg'),
      description: 'RDS Proxy security group',
      allowAllOutbound: true,
    });

    proxySecurityGroup.addIngressRule(
      lambdaSecurityGroup,
      ec2.Port.tcp(5432),
      'Allow Lambda to connect via RDS Proxy',
    );

    databaseSecurityGroup.addIngressRule(
      proxySecurityGroup,
      ec2.Port.tcp(5432),
      'Allow RDS Proxy to connect to Aurora',
    );

    this.credentials = new secretsmanager.Secret(this, 'DatabaseCredentials', {
      secretName: resourceName(config, 'aurora-credentials'),
      description: 'Aurora PostgreSQL master credentials for PetVetCare',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'petvetcare_admin' }),
        generateStringKey: 'password',
        excludePunctuation: true,
        passwordLength: 32,
      },
    });

    const parameterGroup = new rds.ParameterGroup(this, 'ClusterParameterGroup', {
      engine: rds.DatabaseClusterEngine.auroraPostgres({
        version: rds.AuroraPostgresEngineVersion.VER_16_4,
      }),
      description: 'PetVetCare Aurora PostgreSQL cluster parameters',
      parameters: {
        'rds.force_ssl': '1',
        log_statement: 'ddl',
        log_min_duration_statement: '1000',
      },
    });

    this.cluster = new rds.DatabaseCluster(this, 'AuroraCluster', {
      clusterIdentifier: resourceName(config, 'aurora'),
      engine: rds.DatabaseClusterEngine.auroraPostgres({
        version: rds.AuroraPostgresEngineVersion.VER_16_4,
      }),
      credentials: rds.Credentials.fromSecret(this.credentials),
      defaultDatabaseName: config.aurora.databaseName,
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [databaseSecurityGroup],
      serverlessV2MinCapacity: config.aurora.minCapacity,
      serverlessV2MaxCapacity: config.aurora.maxCapacity,
      writer: rds.ClusterInstance.serverlessV2('Writer', {
        publiclyAccessible: false,
        enablePerformanceInsights: config.environment !== 'dev',
      }),
      readers:
        config.environment === 'prod'
          ? [
              rds.ClusterInstance.serverlessV2('Reader', {
                scaleWithWriter: true,
                publiclyAccessible: false,
              }),
            ]
          : undefined,
      parameterGroup,
      backup: {
        retention: cdk.Duration.days(config.aurora.backupRetentionDays),
        preferredWindow: '03:00-04:00',
      },
      preferredMaintenanceWindow: 'sun:04:00-sun:05:00',
      storageEncrypted: true,
      deletionProtection: config.environment === 'prod',
      removalPolicy:
        config.environment === 'prod'
          ? cdk.RemovalPolicy.RETAIN
          : cdk.RemovalPolicy.DESTROY,
      cloudwatchLogsExports: ['postgresql'],
    });

    this.proxy = new rds.DatabaseProxy(this, 'DatabaseProxy', {
      dbProxyName: resourceName(config, 'proxy'),
      proxyTarget: rds.ProxyTarget.fromCluster(this.cluster),
      secrets: [this.credentials],
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [proxySecurityGroup],
      requireTLS: true,
      idleClientTimeout: cdk.Duration.minutes(5),
      maxConnectionsPercent: 90,
      debugLogging: config.environment === 'dev',
    });

    const bootstrapFunction = new nodejs.NodejsFunction(
      this,
      'DatabaseBootstrapFunction',
      {
        functionName: resourceName(config, 'db-bootstrap'),
        runtime: lambda.Runtime.NODEJS_20_X,
        entry: path.join(__dirname, '../../lambda/handlers/database-bootstrap.ts'),
        handler: 'handler',
        timeout: cdk.Duration.minutes(10),
        memorySize: 512,
        vpc,
        vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        securityGroups: [lambdaSecurityGroup],
        environment: {
          DATABASE_HOST: this.cluster.clusterEndpoint.hostname,
          DATABASE_PROXY_ENDPOINT: this.proxy.endpoint,
          DATABASE_PORT: this.cluster.clusterEndpoint.port.toString(),
          DATABASE_NAME: config.aurora.databaseName,
          DATABASE_SECRET_ARN: this.credentials.secretArn,
        },
        bundling: {
          minify: true,
          sourceMap: true,
          target: 'node20',
          externalModules: ['@aws-sdk/client-secrets-manager'],
          nodeModules: ['pg'],
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
        },
        logRetention: logs.RetentionDays.ONE_WEEK,
      },
    );

    this.credentials.grantRead(bootstrapFunction);

    bootstrapFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['rds-db:connect'],
        resources: [
          `arn:aws:rds-db:${this.region}:${this.account}:dbuser:${this.proxy.dbProxyName}/petvetcare_admin`,
        ],
      }),
    );

    const bootstrapProvider = new cr.Provider(this, 'BootstrapProvider', {
      onEventHandler: bootstrapFunction,
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    const bootstrapResource = new cdk.CustomResource(this, 'DatabaseBootstrap', {
      serviceToken: bootstrapProvider.serviceToken,
      properties: {
        ProxyEndpoint: this.proxy.endpoint,
        DatabaseName: config.aurora.databaseName,
        BootstrapVersion: '1',
      },
    });
    bootstrapResource.node.addDependency(this.proxy);

    new cdk.CfnOutput(this, 'ClusterEndpoint', {
      value: this.cluster.clusterEndpoint.hostname,
      exportName: `${stackName(config, 'database')}:ClusterEndpoint`,
    });

    new cdk.CfnOutput(this, 'ProxyEndpoint', {
      value: this.proxy.endpoint,
      exportName: `${stackName(config, 'database')}:ProxyEndpoint`,
    });

    new cdk.CfnOutput(this, 'ClusterPort', {
      value: this.cluster.clusterEndpoint.port.toString(),
      exportName: `${stackName(config, 'database')}:ClusterPort`,
    });

    new cdk.CfnOutput(this, 'DatabaseName', {
      value: config.aurora.databaseName,
      exportName: `${stackName(config, 'database')}:DatabaseName`,
    });

    new cdk.CfnOutput(this, 'DatabaseSecretArn', {
      value: this.credentials.secretArn,
      exportName: `${stackName(config, 'database')}:DatabaseSecretArn`,
    });
  }
}
