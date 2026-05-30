import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import { EnvironmentConfig, resourceName } from '../config/environment';
import { defaultTags, stackName } from '../utils/naming';

export interface DatabaseStackProps extends cdk.StackProps {
  readonly config: EnvironmentConfig;
  readonly vpc: ec2.IVpc;
  readonly databaseSecurityGroup: ec2.ISecurityGroup;
}

export class DatabaseStack extends cdk.Stack {
  public readonly cluster: rds.DatabaseCluster;
  public readonly credentials: secretsmanager.ISecret;

  constructor(scope: Construct, id: string, props: DatabaseStackProps) {
    super(scope, id, props);

    const { config, vpc, databaseSecurityGroup } = props;

    Object.entries(defaultTags(config)).forEach(([key, value]) => {
      cdk.Tags.of(this).add(key, value);
    });

    this.credentials = new secretsmanager.Secret(this, 'DatabaseCredentials', {
      secretName: resourceName(config, 'aurora-credentials'),
      description: 'Aurora PostgreSQL master credentials for Pet Vet Care',
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
      description: 'Pet Vet Care Aurora PostgreSQL cluster parameters',
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
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
      },
      securityGroups: [databaseSecurityGroup],
      serverlessV2MinCapacity: config.aurora.minCapacity,
      serverlessV2MaxCapacity: config.aurora.maxCapacity,
      writer: rds.ClusterInstance.serverlessV2('Writer', {
        publiclyAccessible: false,
        enablePerformanceInsights: config.environment !== 'dev',
        performanceInsightRetention:
          config.environment === 'prod'
            ? rds.PerformanceInsightRetention.MONTHS_1
            : undefined,
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

    new cdk.CfnOutput(this, 'ClusterEndpoint', {
      value: this.cluster.clusterEndpoint.hostname,
      exportName: `${stackName(config, 'database')}:ClusterEndpoint`,
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
