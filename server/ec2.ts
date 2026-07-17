import {
  EC2Client,
  DescribeInstancesCommand,
} from "@aws-sdk/client-ec2";

export async function getEC2Status(
  instanceId: string,
  region: string
) {
  const client = new EC2Client({
    region,
  });

  const command = new DescribeInstancesCommand({
    InstanceIds: [instanceId],
  });

  const response = await client.send(command);

  const state =
    response.Reservations?.[0]?.Instances?.[0]?.State?.Name ??
    "unknown";

  return state;
}
