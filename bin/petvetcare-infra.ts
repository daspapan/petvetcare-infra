#!/usr/bin/env node
import 'dotenv/config';
import * as cdk from 'aws-cdk-lib';
<<<<<<< Updated upstream
import { loadEnvironmentConfig } from '../lib/config/environment';
=======
import * as gitBranch from 'git-branch';
import { loadEnvironmentConfig, resourceName } from '../lib/config/environment';
>>>>>>> Stashed changes
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
  region:  primaryRegion,
};

const stackProps: cdk.StackProps = {
  env,
  description: `PetVetCare infrastructure (${config.environment})`,
};

<<<<<<< Updated upstream
const networkStack = new NetworkStack(app, stackName(config, 'network'), {
  ...stackProps,
  config,
});
=======
// ── Layer 1: no dependencies ──────────────────────────────────────────────────
>>>>>>> Stashed changes

const networkStack = new NetworkStack(app, stackName(config, 'network'), { ...stackProps, config });

const dnsStack = new DnsStack(app, stackName(config, 'dns'), { ...stackProps, config });

const messagingStack = new MessagingStack(app, stackName(config, 'messaging'), { ...stackProps, config });

// ── Layer 2: depends on network ───────────────────────────────────────────────

const databaseStack = new DatabaseStack(app, stackName(config, 'database'), {
  ...stackProps,
  config,
  vpc: networkStack.vpc,
  lambdaSecurityGroup: networkStack.lambdaSecurityGroup,
});
databaseStack.addDependency(networkStack);

<<<<<<< Updated upstream
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
=======
// ── Layer 3: auth depends on database + messaging (trigger Lambdas need both) ─
// Cognito trigger Lambdas live here -- NO cross-stack Lambda ARN exports.
// This is the key architectural decision that eliminates the circular export lock.

const authStack = new AuthStack(app, stackName(config, 'auth'), {
  ...stackProps,
  config,
  otpTable:       databaseStack.otpTable,
  databaseSecret: databaseStack.credentials,
  dbEndpoint:     databaseStack.dbEndpoint,
  dbPort:         databaseStack.dbPort,
  databaseName:   config.database.name,
  sesFromEmail:   messagingStack.sesFromEmail,
});
authStack.addDependency(databaseStack);
authStack.addDependency(messagingStack);

// ── Layer 3 (parallel): public assets ────────────────────────────────────────

const publicAssetsStack = new PublicAssetsStack(app, stackName(config, 'public-assets'), {
  ...stackProps,
  env:    { account: env.account, region: cloudFrontRegion },
  config,
  hostedZone:          dnsStack.hostedZone,
  crossRegionReferences: true,
});
publicAssetsStack.addDependency(dnsStack);

// ── Layer 4: compute depends on auth (direct CDK ref, one-way) ───────────────
// userPool.userPoolId / userPoolArn passed as plain strings -- CDK creates a
// compile-time dependency compute->auth with no CloudFormation export/import.

const hostedUiDomain = `https://${authStack.userPoolDomain.domainName}.auth.${primaryRegion}.amazoncognito.com`;

const computeStack = new ComputeStack(app, stackName(config, 'compute'), {
  ...stackProps,
  config,
  userPoolId:     authStack.userPool.userPoolId,
  userPoolArn:    authStack.userPool.userPoolArn,
  webClientId:    authStack.webUserPoolClient.userPoolClientId,
  hostedUiDomain,
  otpTable:       databaseStack.otpTable,
  databaseSecret: databaseStack.credentials,
  dbEndpoint:     databaseStack.dbEndpoint,
  dbPort:         databaseStack.dbPort,
  databaseName:   config.database.name,
  sesFromEmail:   messagingStack.sesFromEmail,
});
computeStack.addDependency(authStack);
computeStack.addDependency(databaseStack);
computeStack.addDependency(messagingStack); 

// ── Layer 5: api depends on auth + public-assets + database + compute ─────────

const apiStack = new ApiStack(app, stackName(config, 'api'), {
  ...stackProps,
  config,
  userPool:         authStack.userPool,
  userPoolClients:  [authStack.webUserPoolClient, authStack.mobileUserPoolClient],
  publicAssetBucket: publicAssetsStack.publicAssetBucket,
  presignedUrlRole:  publicAssetsStack.presignedUrlRole,
  databaseSecret:   databaseStack.credentials,
  dbEndpoint:       databaseStack.dbEndpoint,
  databasePort:     databaseStack.dbPort,
  databaseName:     config.database.name,
  hostedZone:       dnsStack.hostedZone,
  publicAssetUrl:   publicAssetsStack.publicAssetUrl,
  initiateAuthFn:   computeStack.initiateAuthFn,
  verifyOtpFn:      computeStack.verifyOtpFn,
  refreshTokenFn:   computeStack.refreshTokenFn,
  signOutFn:        computeStack.signOutFn,
  oauthCallbackFn:  computeStack.oauthCallbackFn,
>>>>>>> Stashed changes
});
apiStack.addDependency(networkStack);
apiStack.addDependency(authStack);
apiStack.addDependency(publicAssetsStack);
apiStack.addDependency(databaseStack);
<<<<<<< Updated upstream
=======
apiStack.addDependency(computeStack); 

// ── Layer 6: monitoring ───────────────────────────────────────────────────────

const monitoringStack = new MonitoringStack(app, stackName(config, 'monitoring'), {
  ...stackProps,
  config,
  lambdaFunctions: [
    computeStack.initiateAuthFn,
    computeStack.verifyOtpFn,
    computeStack.refreshTokenFn,
    computeStack.signOutFn,
    computeStack.oauthCallbackFn,
  ],
  restApiName:  resourceName(config, 'rest-api'),
  dbInstanceId: resourceName(config, 'postgres'),
});
monitoringStack.addDependency(computeStack);
monitoringStack.addDependency(apiStack);
>>>>>>> Stashed changes

app.synth();
