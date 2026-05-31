#!/usr/bin/env node
import 'dotenv/config';
import * as cdk from 'aws-cdk-lib';
import { loadEnvironmentConfig } from '../lib/config/environment';
import { stackName } from '../lib/utils/naming';
import { ApiStack } from '../lib/stacks/api-stack';
import { AuthStack } from '../lib/stacks/auth-stack';
import { DatabaseStack } from '../lib/stacks/database-stack';
import { DnsStack } from '../lib/stacks/dns-stack';
import { NetworkStack } from '../lib/stacks/network-stack';
import { PublicAssetsStack } from '../lib/stacks/public-assets-stack';

const app = new cdk.App();
const config = loadEnvironmentConfig();

const primaryRegion = process.env.CDK_DEFAULT_REGION ?? 'ap-south-1';
const cloudFrontRegion = 'ap-south-1'; // 'us-east-1';

const env: cdk.Environment = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: primaryRegion,
};

const stackProps: cdk.StackProps = {
  env,
  description: `PetVetCare infrastructure (${config.environment})`,
};

const networkStack = new NetworkStack(app, stackName(config, 'network'), {
  ...stackProps,
  config,
});

const authStack = new AuthStack(app, stackName(config, 'auth'), {
  ...stackProps,
  config,
});

const dnsStack = new DnsStack(app, stackName(config, 'dns'), {
  ...stackProps,
  config,
});

const publicAssetsStack = new PublicAssetsStack(
  app,
  stackName(config, 'public-assets'),
  {
    ...stackProps,
    env: { account: env.account, region: cloudFrontRegion },
    config,
    hostedZone: dnsStack.hostedZone,
    crossRegionReferences: true,
  },
);
publicAssetsStack.addDependency(dnsStack);

const databaseStack = new DatabaseStack(app, stackName(config, 'database'), {
  ...stackProps,
  config,
  vpc: networkStack.vpc,
  lambdaSecurityGroup: networkStack.lambdaSecurityGroup,
});
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
  publicAssetBucket: publicAssetsStack.publicAssetBucket,
  presignedUrlRole: publicAssetsStack.presignedUrlRole,
  databaseSecret: databaseStack.credentials,
  databaseProxyEndpoint: databaseStack.proxy.endpoint,
  databasePort: '5432',
  databaseName: config.aurora.databaseName,
  hostedZone: dnsStack.hostedZone,
  publicAssetUrl: publicAssetsStack.publicAssetUrl,
  databaseProxy: databaseStack.proxy,
});
apiStack.addDependency(networkStack);
apiStack.addDependency(authStack);
apiStack.addDependency(publicAssetsStack);
apiStack.addDependency(databaseStack);

app.synth();
