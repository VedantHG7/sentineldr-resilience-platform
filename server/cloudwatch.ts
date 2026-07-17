import {
  CloudWatchClient,
  GetMetricStatisticsCommand,
} from "@aws-sdk/client-cloudwatch";

const cloudwatch = new CloudWatchClient({
  region: process.env.AWS_REGION || "ap-south-1",
});

export async function getEC2CPUUtilization(instanceId: string, region: string) {
  const client = new CloudWatchClient({
    region,
  });

  const endTime = new Date();
  const startTime = new Date(endTime.getTime() - 10 * 60 * 1000);

  const command = new GetMetricStatisticsCommand({
    Namespace: "AWS/EC2",
    MetricName: "CPUUtilization",
    Dimensions: [
      {
        Name: "InstanceId",
        Value: instanceId,
      },
    ],
    StartTime: startTime,
    EndTime: endTime,
    Period: 300,
    Statistics: ["Average"],
  });

  const response = await client.send(command);

  if (!response.Datapoints || response.Datapoints.length === 0) {
    return 0;
  }

  response.Datapoints.sort(
    (a, b) =>
      new Date(b.Timestamp!).getTime() -
      new Date(a.Timestamp!).getTime()
  );

  return response.Datapoints[0].Average ?? 0;
}

export async function getEC2MemoryUtilization(instanceId: string, region: string) {
  const client = new CloudWatchClient({
    region,
  });

  const endTime = new Date();
  const startTime = new Date(endTime.getTime() - 10 * 60 * 1000);

  const command = new GetMetricStatisticsCommand({
    Namespace: "CWAgent",
    MetricName: "mem_used_percent",
    Dimensions: [
      {
        Name: "InstanceId",
        Value: instanceId,
      },
    ],
    StartTime: startTime,
    EndTime: endTime,
    Period: 300,
    Statistics: ["Average"],
  });

  const response = await client.send(command);

  if (!response.Datapoints || response.Datapoints.length === 0) {
    return 0;
  }

  response.Datapoints.sort(
    (a, b) =>
      new Date(b.Timestamp!).getTime() -
      new Date(a.Timestamp!).getTime()
  );

  return response.Datapoints[0].Average ?? 0;
}
