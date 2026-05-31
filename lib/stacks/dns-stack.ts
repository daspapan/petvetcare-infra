import * as cdk from 'aws-cdk-lib';
import * as route53 from 'aws-cdk-lib/aws-route53';
import { Construct } from 'constructs';
import { EnvironmentConfig } from '../config/environment';
import { defaultTags, stackName } from '../utils/naming';

export interface DnsStackProps extends cdk.StackProps {
  readonly config: EnvironmentConfig;
}

/**
 * Imports an existing Route 53 hosted zone. Never creates a new zone.
 */
export class DnsStack extends cdk.Stack {
  public readonly hostedZone: route53.IHostedZone;

  constructor(scope: Construct, id: string, props: DnsStackProps) {
    super(scope, id, props);

    const { config } = props;

    Object.entries(defaultTags(config)).forEach(([key, value]) => {
      cdk.Tags.of(this).add(key, value);
    });

    this.hostedZone = route53.HostedZone.fromHostedZoneAttributes(
      this,
      'ImportedHostedZone',
      {
        hostedZoneId: config.dns.hostedZoneId,
        zoneName: config.dns.domainName,
      },
    );

    new cdk.CfnOutput(this, 'HostedZoneId', {
      value: config.dns.hostedZoneId,
      exportName: `${stackName(config, 'dns')}:HostedZoneId`,
    });

    new cdk.CfnOutput(this, 'DnsManagementNote', {
      value:
        'Hosted zone is imported only. Configure DNS records externally or set CREATE_DNS_RECORDS=true.',
    });
  }
}
