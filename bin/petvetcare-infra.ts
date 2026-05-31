#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { loadEnvironmentConfig } from '../lib/config/environment';
import { stackName } from '../lib/utils/naming';
import { ApiStack } from '../lib/stacks/api-stack';
import { AuthStack } from '../lib/stacks/auth-stack';
import { DatabaseStack } from '../lib/stacks/database-stack';
import { DnsStack } from '../lib/stacks/dns-stack';
import { NetworkStack } from '../lib/stacks/network-stack';
import { StorageStack } from '../lib/stacks/storage-stack';

const app = new cdk.App();
const config = loadEnvironmentConfig();

const env: cdk.Environment = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
};

const stackProps: cdk.StackProps = {
  env,
  description: `PetVetCare infrastructure (${config.environment})`,
};

// VPC, Security Groups, Subnets
const networkStack = new NetworkStack(
  app,
  stackName(config, 'network'),
  {
    ...stackProps,
    config,
  },
);

const authStack = new AuthStack(app, stackName(config, 'auth'), {
  ...stackProps,
  config,
});

const dnsStack = new DnsStack(app, stackName(config, 'dns'), {
  ...stackProps,
  config,
});

const storageStack = new StorageStack(
  app,
  stackName(config, 'storage'),
  {
    ...stackProps,
    config,
    hostedZone: dnsStack.hostedZone,
  },
);
storageStack.addDependency(dnsStack);

const databaseStack = new DatabaseStack(
  app,
  stackName(config, 'database'),
  {
    ...stackProps,
    config,
    vpc: networkStack.vpc,
    databaseSecurityGroup: networkStack.databaseSecurityGroup,
  },
);
databaseStack.addDependency(networkStack);

const apiStack = new ApiStack(app, stackName(config, 'api'), {
  ...stackProps,
  config,
  vpc: networkStack.vpc,
  lambdaSecurityGroup: networkStack.lambdaSecurityGroup,
  userPool: authStack.userPool,
  userPoolClients: [
    authStack.webUserPoolClient,
    authStack.mobileUserPoolClient,
  ],
  userContentBucket: storageStack.userContentBucket,
  presignedUrlRole: storageStack.presignedUrlRole,
  databaseSecret: databaseStack.credentials,
  databaseEndpoint: databaseStack.cluster.clusterEndpoint.hostname,
  databasePort: databaseStack.cluster.clusterEndpoint.port.toString(),
  databaseName: config.aurora.databaseName,
  hostedZone: dnsStack.hostedZone,
  cdnDomainName: storageStack.cdnDomainName,
}); 
apiStack.addDependency(dnsStack);
apiStack.addDependency(networkStack);
apiStack.addDependency(authStack);
apiStack.addDependency(storageStack);
apiStack.addDependency(databaseStack);

app.synth();
