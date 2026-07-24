import LinqAPIV3 from "@linqapp/sdk";
import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";

export type LinqStatus = {
  mode: "demo" | "connected" | "error";
  label: string;
  phoneNumber: string | null;
  phoneDisplay: string;
  lineHealth: "HEALTHY" | "AT_RISK" | "CRITICAL" | null;
};

export async function GET() {
  let env: ReturnType<typeof getEnv>;
  try {
    env = getEnv();
  } catch {
    return NextResponse.json<LinqStatus>({
      mode: "error",
      label: "LINQ MISCONFIGURED",
      phoneNumber: null,
      phoneDisplay: "Configuration required",
      lineHealth: null,
    });
  }

  if (env.USE_MOCK_LINQ) {
    return NextResponse.json<LinqStatus>({
      mode: "demo",
      label: "DEMO MODE",
      phoneNumber: null,
      phoneDisplay: "Add Linq credentials to connect",
      lineHealth: null,
    });
  }

  try {
    const client = new LinqAPIV3({
      apiKey: env.LINQ_API_KEY,
      webhookSecret: env.LINQ_WEBHOOK_SECRET,
    });
    const response = await client.phoneNumbers.list();
    const line = response.phone_numbers.find(
      (candidate) => candidate.phone_number === env.LINQ_PHONE_NUMBER,
    );

    if (!line) {
      return NextResponse.json<LinqStatus>({
        mode: "error",
        label: "LINE NOT ASSIGNED",
        phoneNumber: null,
        phoneDisplay: env.LINQ_PHONE_NUMBER ?? "Unknown line",
        lineHealth: null,
      });
    }

    return NextResponse.json<LinqStatus>({
      mode: "connected",
      label: "IMESSAGE CONNECTED",
      phoneNumber: line.phone_number,
      phoneDisplay: line.phone_number,
      lineHealth: line.reputation.status,
    });
  } catch {
    return NextResponse.json<LinqStatus>({
      mode: "error",
      label: "LINQ UNREACHABLE",
      phoneNumber: null,
      phoneDisplay: env.LINQ_PHONE_NUMBER ?? "Check credentials",
      lineHealth: null,
    });
  }
}
