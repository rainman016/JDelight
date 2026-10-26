export function writeInviteCodes(options: {
  count?: number;
  out: string;
  pick?: (max: number) => number;
}): Promise<string>;
