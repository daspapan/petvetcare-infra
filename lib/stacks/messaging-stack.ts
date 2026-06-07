import * as cdk from 'aws-cdk-lib';
import * as ses from 'aws-cdk-lib/aws-ses';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import { Construct } from 'constructs';
import { EnvironmentConfig, resourceName } from '../config/environment';
import { defaultTags, stackName } from '../utils/naming';

export interface MessagingStackProps extends cdk.StackProps {
  readonly config: EnvironmentConfig;
}

export class MessagingStack extends cdk.Stack {
  public readonly sesFromEmail: string;

  constructor(scope: Construct, id: string, props: MessagingStackProps) {
    super(scope, id, props);

    const { config } = props;

    Object.entries(defaultTags(config)).forEach(([key, value]) => {
      cdk.Tags.of(this).add(key, value);
    });

    this.sesFromEmail =
      process.env.SES_FROM_EMAIL ?? 'noreply@petvetcare.app';

    // SES email identity
    /*
    const emailIdentity = new ses.EmailIdentity(this, 'SesEmailIdentity', {
      identity: ses.Identity.email(this.sesFromEmail),
    });
    */
    const emailIdentity = ses.EmailIdentity.fromEmailIdentityArn( 
      this, 
      'ExistingSesEmailIdentity', 
      `arn:aws:ses:${this.region}:${this.account}:identity/${this.sesFromEmail}`
    );  

    // SES Configuration Set
    const configurationSet = new ses.ConfigurationSet(this, 'SesConfigurationSet', {
      configurationSetName: resourceName(config, 'ses-config'),
      sendingEnabled: true,
    });

    new cdk.CfnOutput(this, 'SesFromEmail', {
      value: this.sesFromEmail,
      exportName: `${stackName(config, 'messaging')}:SesFromEmail`,
    });

    new cdk.CfnOutput(this, 'SesConfigurationSetName', {
      value: configurationSet.configurationSetName,
      exportName: `${stackName(config, 'messaging')}:SesConfigurationSetName`,
    });

    // Suppress unused warning
    void emailIdentity;
  }
}
