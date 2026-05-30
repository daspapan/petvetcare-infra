import * as cdk from 'aws-cdk-lib';
import * as route53 from 'aws-cdk-lib/aws-route53';
import { Construct } from 'constructs';
import { EnvironmentConfig } from '../config/environment';
import { defaultTags, stackName } from '../utils/naming';

export interface DnsStackProps extends cdk.StackProps {
  readonly config: EnvironmentConfig;
}

export class DnsStack extends cdk.Stack {
  public readonly hostedZone: route53.IHostedZone;

  constructor(scope: Construct, id: string, props: DnsStackProps) {
    super(scope, id, props);

    const { config } = props;

    Object.entries(defaultTags(config)).forEach(([key, value]) => {
      cdk.Tags.of(this).add(key, value);
    });

    if (config.hostedZoneId) {
      this.hostedZone = route53.HostedZone.fromHostedZoneAttributes(
        this,
        'HostedZone',
        {
          hostedZoneId: config.hostedZoneId,
          zoneName: config.domainName,
        },
      );
    } else {
      this.hostedZone = new route53.PublicHostedZone(this, 'HostedZone', {
        zoneName: config.domainName,
        comment: `Public hosted zone for ${config.domainName}`,
      });
    }

    new cdk.CfnOutput(this, 'HostedZoneId', {
      value: this.hostedZone.hostedZoneId,
      exportName: `${stackName(config, 'dns')}:HostedZoneId`,
    });

    if (!config.hostedZoneId && this.hostedZone.hostedZoneNameServers) {
      new cdk.CfnOutput(this, 'NameServers', {
        value: cdk.Fn.join(',', this.hostedZone.hostedZoneNameServers),
        description: 'Delegate petvetcare.app to these Route 53 name servers',
      });
    }
  }
}
