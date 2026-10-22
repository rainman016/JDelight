export function setupEnvironment(options: {
  cwd?: string;
  home?: string;
  tty?: boolean;
  prompt: (label: string, hidden: boolean) => Promise<string>;
  output?: (message: string) => void;
  ignored?: () => boolean;
}): Promise<void>;
