import * as cdk from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53Targets from 'aws-cdk-lib/aws-route53-targets';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import { Construct } from 'constructs';
import { EnvironmentConfig, resourceName } from '../config/environment';
import { defaultTags, stackName } from '../utils/naming';

export interface StorageStackProps extends cdk.StackProps {
  readonly config: EnvironmentConfig;
  readonly hostedZone: route53.IHostedZone;
}

export class StorageStack extends cdk.Stack {
  public readonly userContentBucket: s3.Bucket;
  public readonly distribution: cloudfront.Distribution;
  public readonly presignedUrlRole: iam.Role;
  public readonly cdnDomainName: string;

  constructor(scope: Construct, id: string, props: StorageStackProps) {
    super(scope, id, props);

    const { config, hostedZone } = props;
    this.cdnDomainName = `${config.cdnSubdomain}.${config.domainName}`;

    Object.entries(defaultTags(config)).forEach(([key, value]) => {
      cdk.Tags.of(this).add(key, value);
    });

    this.userContentBucket = new s3.Bucket(this, 'UserContentBucket', {
      bucketName: resourceName(config, 'user-content'),
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: config.environment === 'prod',
      encryption: s3.BucketEncryption.S3_MANAGED,
      cors: [
        {
          allowedMethods: [
            s3.HttpMethods.GET,
            s3.HttpMethods.PUT,
            s3.HttpMethods.POST,
            s3.HttpMethods.HEAD,
          ],
          allowedOrigins: [
            config.cors.webAppOrigin,
            ...(config.cors.mobileAppOrigin !== '*'
              ? [config.cors.mobileAppOrigin]
              : ['*']),
          ],
          allowedHeaders: ['*'],
          exposedHeaders: ['ETag'],
          maxAge: 3600,
        },
      ],
      lifecycleRules: [
        {
          id: 'AbortIncompleteMultipartUploads',
          abortIncompleteMultipartUploadAfter: cdk.Duration.days(7),
        },
      ],
      removalPolicy:
        config.environment === 'prod'
          ? cdk.RemovalPolicy.RETAIN
          : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: config.environment !== 'prod',
    });

    const cdnCertificate = new acm.Certificate(this, 'CdnCertificate', {
      domainName: this.cdnDomainName,
      validation: acm.CertificateValidation.fromDns(hostedZone),
    });

    const originAccessControl = new cloudfront.S3OriginAccessControl(
      this,
      'UserContentOac',
      {
        originAccessControlName: resourceName(config, 'user-content-oac'),
        signing: cloudfront.Signing.SIGV4_ALWAYS,
      },
    );

    this.distribution = new cloudfront.Distribution(this, 'UserContentCdn', {
      comment: `Pet Vet Care user content CDN (${config.environment})`,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(
          this.userContentBucket,
          {
            originAccessControl,
          },
        ),
        viewerProtocolPolicy:
          cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD_OPTIONS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        compress: true,
      },
      domainNames: [this.cdnDomainName],
      certificate: cdnCertificate,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      priceClass:
        config.environment === 'prod'
          ? cloudfront.PriceClass.PRICE_CLASS_ALL
          : cloudfront.PriceClass.PRICE_CLASS_100,
    });

    this.userContentBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'AllowCloudFrontServicePrincipalRead',
        effect: iam.Effect.ALLOW,
        principals: [new iam.ServicePrincipal('cloudfront.amazonaws.com')],
        actions: ['s3:GetObject'],
        resources: [this.userContentBucket.arnForObjects('*')],
        conditions: {
          StringEquals: {
            'AWS:SourceArn': `arn:aws:cloudfront::${this.account}:distribution/${this.distribution.distributionId}`,
          },
        },
      }),
    );

    this.presignedUrlRole = new iam.Role(this, 'PresignedUrlRole', {
      roleName: resourceName(config, 'presigned-url-role'),
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description:
        'Generates pre-signed S3 URLs for secure direct-to-S3 client uploads',
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          'service-role/AWSLambdaBasicExecutionRole',
        ),
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          'service-role/AWSLambdaVPCAccessExecutionRole',
        ),
      ],
    });

    this.presignedUrlRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'GeneratePresignedUrls',
        effect: iam.Effect.ALLOW,
        actions: ['s3:PutObject', 's3:GetObject', 's3:AbortMultipartUpload'],
        resources: [this.userContentBucket.arnForObjects('*')],
      }),
    );

    this.presignedUrlRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'ListBucketForMultipartUploads',
        effect: iam.Effect.ALLOW,
        actions: ['s3:ListBucketMultipartUploads'],
        resources: [this.userContentBucket.bucketArn],
      }),
    );

    new route53.ARecord(this, 'CdnAliasRecord', {
      zone: hostedZone,
      recordName: config.cdnSubdomain,
      target: route53.RecordTarget.fromAlias(
        new route53Targets.CloudFrontTarget(this.distribution),
      ),
    });

    new cdk.CfnOutput(this, 'UserContentBucketName', {
      value: this.userContentBucket.bucketName,
      exportName: `${stackName(config, 'storage')}:UserContentBucketName`,
    });

    new cdk.CfnOutput(this, 'UserContentBucketArn', {
      value: this.userContentBucket.bucketArn,
      exportName: `${stackName(config, 'storage')}:UserContentBucketArn`,
    });

    new cdk.CfnOutput(this, 'CdnDomainName', {
      value: this.cdnDomainName,
      exportName: `${stackName(config, 'storage')}:CdnDomainName`,
    });

    new cdk.CfnOutput(this, 'CloudFrontDistributionId', {
      value: this.distribution.distributionId,
    });
  }
}
